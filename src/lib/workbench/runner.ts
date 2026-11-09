import { calculateApiCost } from '@/lib/cost-utils';
import type { GptImageModel } from '@/lib/models';
import { getImageApiClient, ConfigurationError, FixtureConfigurationError, isImageApiFixtureTest } from '@/lib/server/image-api';
import { readAssetBytes, saveAssetFromBytes } from '@/lib/workbench/assets';
import { getStaleSendingMs } from '@/lib/workbench/config';
import {
    claimNextItem,
    createReviewItem,
    createVersion,
    finalizeRunStatus,
    getAsset,
    getRun,
    getVersion,
    listRunVersions,
    markItemFailed,
    markItemSkipped,
    markItemSuccess,
    markReviewUnavailable,
    markSendingAsUnknown,
    recoverStaleSending,
    setVersionReview,
    setVersionReviewStatus,
    skipPendingItems,
    updateRunState,
    setWorkerHeartbeat,
    nowIso,
    type ClaimedItem
} from '@/lib/workbench/store';
import type { AssetMeta, ReviewResult, RunSummary, VersionRecord } from '@/lib/workbench/types';
import { reviewImages } from '@/lib/workbench/vision';

export type TickResult = {
    didWork: boolean;
    recovered: number;
    runId?: string;
    itemId?: string;
    kind?: string;
    outcome?: string;
    status?: string;
};

export async function tick(): Promise<TickResult> {
    const recovered = recoverStaleSending(getStaleSendingMs());
    const claimed = claimNextItem();
    if (!claimed) {
        setWorkerHeartbeat({ tickAt: nowIso(), didWork: false, runId: null });
        return { didWork: false, recovered };
    }

    let outcome = 'ok';
    try {
        if (claimed.item.kind === 'review') {
            outcome = await executeReview(claimed);
        } else {
            outcome = await executeImage(claimed);
        }
    } catch (error) {
        outcome = `runner_error:${error instanceof Error ? error.message : String(error)}`;
        markSendingAsUnknown(claimed.item.id, 'RUNNER_ERROR', '执行器异常，结果未知；未自动重发。');
        updateRunState(claimed.run.id, {
            status: 'paused_unknown',
            errorCode: 'RUNNER_ERROR',
            errorMessage: '执行器异常，已发送步骤结果未知；请先核实。'
        });
    }

    finalizeRunStatus(claimed.run.id);
    const refreshed = getRun(claimed.run.id);
    setWorkerHeartbeat({ tickAt: nowIso(), didWork: true, runId: claimed.run.id });
    return {
        didWork: true,
        recovered,
        runId: claimed.run.id,
        itemId: claimed.item.id,
        kind: claimed.item.kind,
        outcome,
        status: refreshed?.status
    };
}

async function executeImage(claimed: ClaimedItem): Promise<string> {
    const { run, item, snapshot } = claimed;

    const preflight = assessPreflight(run);
    if (preflight.action !== 'ok') {
        markItemSkipped(item.id, preflight.action === 'budget' ? 'BUDGET_EXCEEDED' : preflight.action === 'calls' ? 'CALL_LIMIT_EXCEEDED' : 'COST_UNKNOWN', preflight.message);
        haltRun(
            run.id,
            preflight.action === 'budget' ? 'BUDGET_EXCEEDED' : preflight.action === 'calls' ? 'CALL_LIMIT_EXCEEDED' : 'COST_UNKNOWN',
            preflight.message,
            'paused_budget'
        );
        return `skipped:${preflight.action}`;
    }

    if (snapshot.mock && !isImageApiFixtureTest()) {
        markItemFailed(item.id, 'TEST_DATA_NOT_EXECUTABLE', '历史测试任务不能发送真实请求；原始数据仍保留。', false);
        return 'failed:test_data_not_executable';
    }

    const model = snapshot.params.model as GptImageModel;
    const referenceAssets: AssetMeta[] = [];
    for (const reference of [...snapshot.references].sort((a, b) => a.position - b.position)) {
        const asset = getAsset(reference.assetId);
        if (!asset) {
            markItemFailed(item.id, 'REFERENCE_MISSING', `参考图 ${reference.filename} 已不存在；未发送请求。`, false);
            return 'failed:reference_missing';
        }
        if (asset.mock && !isImageApiFixtureTest()) {
            markItemFailed(item.id, 'TEST_DATA_NOT_EXECUTABLE', '历史测试参考不能发送到真实模型。', false);
            return 'failed:test_reference';
        }
        referenceAssets.push(asset);
    }

    let baseVersion: VersionRecord | null = null;
    if (snapshot.operation.action === 'revise') {
        baseVersion = snapshot.operation.baseVersionId ? getVersion(snapshot.operation.baseVersionId) : null;
        if (!baseVersion || baseVersion.projectId !== run.projectId) {
            markItemFailed(item.id, 'BASE_VERSION_MISSING', '修订基底版本不存在；未发送请求。', false);
            return 'failed:base_version_missing';
        }
        if ((baseVersion.mock || baseVersion.asset.mock) && !isImageApiFixtureTest()) {
            markItemFailed(item.id, 'TEST_DATA_NOT_EXECUTABLE', '历史测试版本不能作为真实修订基底。', false);
            return 'failed:test_base_version';
        }
    }

    const files: File[] = [];
    try {
        if (baseVersion) {
            const bytes = await readAssetBytes(baseVersion.asset);
            files.push(
                new File(
                    [new Uint8Array(bytes)],
                    `00-base-${baseVersion.label}-${baseVersion.asset.filename}`.slice(0, 160),
                    { type: baseVersion.asset.mime }
                )
            );
        }
        for (let index = 0; index < referenceAssets.length; index++) {
            const asset = referenceAssets[index];
            const reference = snapshot.references.find((entry) => entry.assetId === asset.id);
            const purpose = reference?.purpose ?? 'reference';
            const bytes = await readAssetBytes(asset);
            files.push(
                new File(
                    [new Uint8Array(bytes)],
                    `${String(index + 1).padStart(2, '0')}-${purpose}-${asset.filename}`.slice(0, 160),
                    { type: asset.mime }
                )
            );
        }
    } catch (error) {
        markItemFailed(
            item.id,
            'LOCAL_INPUT_ERROR',
            `读取参考图或修订基底失败：${error instanceof Error ? error.message : String(error)}。未发送请求。`,
            false
        );
        return 'failed:local_input';
    }

    const prompt = `${snapshot.prompt}\n\n【避免项】${snapshot.avoid}`;
    const imageParams = {
        n: 1 as const,
        size: snapshot.params.size,
        quality: snapshot.params.quality as 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max',
        background: snapshot.params.background as 'auto' | 'opaque' | 'transparent',
        output_format: snapshot.params.outputFormat as 'png' | 'jpeg' | 'webp',
        moderation: snapshot.params.moderation as 'auto' | 'low'
    };

    let dispatched = false;
    try {
        const client = getImageApiClient({ localRequestId: item.id, runId: run.id, itemId: item.id });
        dispatched = true;
        const apiResult =
            files.length > 0
                ? await client.edit({
                      model,
                      prompt,
                      image: files,
                      ...imageParams
                  })
                : await client.generate({
                      model,
                      prompt,
                      ...imageParams
                  });

        const images = apiResult.result.data ?? [];
        const first = images[0];
        if (!first?.b64_json) {
            markItemFailed(item.id, 'UPSTREAM_NO_IMAGE', '上游没有返回图片数据。', false);
            return 'failed:no_image';
        }

        const bytes = Buffer.from(first.b64_json, 'base64');
        const ext = snapshot.params.outputFormat === 'jpeg' ? 'jpg' : snapshot.params.outputFormat;
        const cost = calculateApiCost(apiResult.result.usage, model);
        const usage = (apiResult.result.usage as Record<string, unknown> | null | undefined) ?? null;

        let saved: { asset: AssetMeta; deduped: boolean };
        let version: VersionRecord;
        try {
            saved = await saveAssetFromBytes({
                bytes,
                originalName: `${run.action}-${run.id.slice(0, 8)}-${item.position + 1}.${ext}`,
                kind: 'generated',
                projectId: run.projectId,
                sourcePage: null,
                sourceUrl: null,
                mock: apiResult.mock
            });
            version = createVersion({
                projectId: run.projectId,
                runId: run.id,
                itemId: item.id,
                assetId: saved.asset.id,
                parentVersionId:
                    snapshot.operation.action === 'revise' ? snapshot.operation.baseVersionId ?? null : null,
                mock: apiResult.mock
            });
        } catch (error) {
            markItemFailed(
                item.id,
                'LOCAL_SAVE_ERROR',
                `上游已返回图片，但本地保存或版本写入失败：${error instanceof Error ? error.message : String(error)}。未自动重试。`,
                false,
                {
                    usage,
                    estimatedCostUsd: cost?.estimated_cost_usd ?? null,
                    openaiRequestId: apiResult.openaiRequestId
                }
            );
            return 'failed:local_save';
        }

        markItemSuccess({
            itemId: item.id,
            requestId: run.id,
            openaiRequestId: apiResult.openaiRequestId,
            usage,
            estimatedCostUsd: cost?.estimated_cost_usd ?? null,
            outputAssetId: saved.asset.id,
            versionId: version.id
        });

        const refreshed = getRun(run.id);
        if (refreshed?.status === 'paused_unknown' && !refreshed.items.some((entry) => entry.status === 'unknown')) {
            updateRunState(run.id, { status: 'running', errorCode: null, errorMessage: null });
        }
        const afterRecovery = getRun(run.id);
        try {
            if (afterRecovery?.stopRequested) {
                setVersionReviewStatus(version.id, 'unavailable');
            } else {
                const nextPosition = afterRecovery
                    ? Math.max(...afterRecovery.items.map((entry) => entry.position)) + 1
                    : 100;
                createReviewItem(run.id, version.id, nextPosition);
            }
        } catch (error) {
            setVersionReviewStatus(version.id, 'unavailable');
            updateRunState(run.id, {
                errorMessage: `图片已保存，但审稿步骤未能排队：${error instanceof Error ? error.message : String(error)}。`
            });
        }

        if (images.length > 1) {
            updateRunState(run.id, {
                errorMessage: `上游意外返回 ${images.length} 张图片；本次只保存第一张，未自动追加。`
            });
        }

        if (!cost) {
            haltRun(
                run.id,
                'COST_UNKNOWN',
                '上游未返回 usage，后续费用无法核对；已暂停后续付费调用，请核实后再继续。',
                'paused_budget'
            );
            return 'success:cost_unknown';
        }

        return 'success';
    } catch (error) {
        const classified = classifyImageError(error, dispatched);
        if (classified.unknown) {
            markSendingAsUnknown(item.id, classified.code, classified.message);
            updateRunState(run.id, {
                status: 'paused_unknown',
                errorCode: classified.code,
                errorMessage: `${classified.message} 请求可能已到达上游，系统未自动重发；请先核实。如自行重新提交，可能重复收费。`
            });
            return 'unknown';
        }
        markItemFailed(item.id, classified.code, classified.message, false);
        return 'failed';
    }
}

async function executeReview(claimed: ClaimedItem): Promise<string> {
    const { run, item } = claimed;
    if (run.snapshot.mock && !isImageApiFixtureTest()) {
        if (item.targetVersionId) markReviewUnavailable(item.id, item.targetVersionId, '历史测试结果不能发送到真实审稿模型。');
        else markItemSkipped(item.id, 'TEST_DATA_NOT_EXECUTABLE', '历史测试任务不能发送真实请求。');
        return 'review_unavailable:test_data_not_executable';
    }
    if (!item.targetVersionId) {
        markItemSkipped(item.id, 'REVIEW_TARGET_MISSING', '审稿目标版本缺失，已跳过。');
        return 'skipped';
    }
    const target = getVersion(item.targetVersionId);
    if (!target) {
        markReviewUnavailable(item.id, item.targetVersionId, '审稿目标版本不存在。');
        return 'review_unavailable';
    }

    const preflight = assessPreflight(run);
    if (preflight.action === 'calls') {
        markReviewUnavailable(item.id, target.id, '调用次数上限已到，审稿未执行；图片已保留。');
        return 'review_unavailable:calls';
    }

    const runVersions = listRunVersions(run.id);
    let generated = [{ asset: target.asset, label: target.label }];
    let comparisonTargets: { first: { versionId: string; label: string }; second: { versionId: string; label: string } } | undefined;

    if (run.snapshot.params.imageCount === 2 && runVersions.length >= 2) {
        const first = runVersions[0];
        const second = runVersions[1];
        if (target.id === second.id) {
            generated = [
                { asset: first.asset, label: first.label },
                { asset: second.asset, label: second.label }
            ];
            comparisonTargets = {
                first: { versionId: first.id, label: first.label },
                second: { versionId: second.id, label: second.label }
            };
        }
    }

    const references: AssetMeta[] = [];
    for (const reference of run.snapshot.references) {
        const asset = getAsset(reference.assetId);
        if (asset) references.push(asset);
    }

    try {
        const review: ReviewResult = await reviewImages({
            generated,
            comparisonTargets,
            references,
            design: run.snapshot.designCard,
            lockedFields: run.snapshot.lockedFields,
            acceptance: run.snapshot.acceptance,
            mock: run.snapshot.mock
        });
        setVersionReview(target.id, review);
        markItemSuccess({ itemId: item.id, versionId: target.id, usage: null, estimatedCostUsd: null });
        return 'success';
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        markReviewUnavailable(item.id, target.id, `审稿失败：${message.slice(0, 300)}。图片已保留，未重新生成。`);
        return 'review_unavailable';
    }
}

function assessPreflight(run: RunSummary): { action: 'ok' | 'budget' | 'calls' | 'cost_unknown'; message: string } {
    const maxCalls = run.snapshot.authorization.maxCalls;
    const maxImages = run.snapshot.authorization.maxImageOutputs;
    const dispatched = run.items.filter((item) => !['pending', 'skipped', 'review_unavailable'].includes(item.status));
    const dispatchedCalls = dispatched.length;
    const imageItems = run.items.filter((item) => item.kind === 'image');
    const dispatchedImages = imageItems.filter((item) => !['pending', 'skipped'].includes(item.status)).length;

    if (dispatchedCalls > maxCalls) {
        return { action: 'calls', message: `调用次数上限 ${maxCalls} 已到，未发送新的付费请求。` };
    }
    if (dispatchedImages > maxImages) {
        return { action: 'calls', message: `图片数量上限 ${maxImages} 已到，未发送新的生成请求。` };
    }

    const spent = imageItems.reduce((sum, entry) => sum + (entry.estimatedCostUsd ?? 0), 0);
    const perImage =
        run.snapshot.estimate.estimatedImageUsd !== null && run.snapshot.estimate.imageCalls > 0
            ? run.snapshot.estimate.estimatedImageUsd / run.snapshot.estimate.imageCalls
            : 0;
    if (spent + perImage > run.snapshot.authorization.budgetUsd + 1e-9) {
        return {
            action: 'budget',
            message: `预算上限 $${run.snapshot.authorization.budgetUsd.toFixed(4)} 不足以覆盖下一次估算（已用约 $${spent.toFixed(4)}，单张约 $${perImage.toFixed(4)}）；未发送请求。`
        };
    }

    const unknownCost = imageItems.some((entry) => entry.status === 'success' && entry.estimatedCostUsd === null);
    if (unknownCost) {
        return {
            action: 'cost_unknown',
            message: '前序成功结果缺少 usage，费用无法核对；已暂停后续付费调用，请先核实。'
        };
    }

    return { action: 'ok', message: '' };
}

function haltRun(runId: string, code: string, message: string, status: 'paused_budget' | 'paused_unknown') {
    const run = getRun(runId);
    if (run) {
        for (const item of run.items) {
            if (item.kind === 'review' && item.status === 'pending' && item.targetVersionId) {
                markReviewUnavailable(item.id, item.targetVersionId, `${message} 审稿未执行，图片已保留。`);
            }
        }
    }
    skipPendingItems(runId, code, message);
    updateRunState(runId, { status, errorCode: code, errorMessage: message });
}

function classifyImageError(error: unknown, dispatched: boolean): { unknown: boolean; code: string; message: string } {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ConfigurationError) {
        return { unknown: false, code: error.code, message };
    }
    if (error instanceof FixtureConfigurationError) {
        return { unknown: false, code: 'TEST_FIXTURE_CONFIGURATION_ERROR', message };
    }
    if (error instanceof Error && /timeout|timed out|APIConnectionTimeout/i.test(`${error.name} ${error.message}`)) {
        return { unknown: true, code: 'UPSTREAM_TIMEOUT', message: message.slice(0, 300) };
    }
    const status =
        typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
            ? error.status
            : undefined;
    if (status !== undefined) {
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
            return { unknown: false, code: `UPSTREAM_HTTP_${status}`, message: message.slice(0, 300) };
        }
        return { unknown: true, code: `UPSTREAM_HTTP_${status}`, message: message.slice(0, 300) };
    }
    return {
        unknown: dispatched,
        code: dispatched ? 'UPSTREAM_UNKNOWN' : 'LOCAL_ERROR',
        message: message.slice(0, 300)
    };
}
