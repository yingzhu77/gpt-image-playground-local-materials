import {
    assertSameOrigin,
    errorResponse,
    readJsonBody,
    requireLoopbackHost,
    requireLocalRequestSlot,
    verifyAppPassword,
    workbenchJson
} from '@/lib/workbench/http';
import {
    abandonUnknownAction,
    analyzeAsset,
    compileProjectPrompt,
    createGenerationRun,
    createRerollRun,
    createRevisionRun,
    estimateRunPreview,
    forkProject,
    getProjectDetail,
    importCandidate,
    keepManualPrompt,
    runSearch,
    saveBindings,
    saveDesignCard,
    saveManualPrompt,
    setBaselineAction,
    stopRunAction,
    unlockFields,
    updateAssetAnalysis,
    updateDesignFromInstruction,
    updateProjectName,
    uploadAsset,
    WorkbenchError
} from '@/lib/workbench/service';
import { getAsset } from '@/lib/workbench/store';
import type { CreateRunInput } from '@/lib/workbench/types';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    let release: (() => void) | undefined;
    try {
        requireLoopbackHost(request);
        assertSameOrigin(request);
        verifyAppPassword(request);
        release = requireLocalRequestSlot();
        const { id: projectId } = await params;
        const body = await readJsonBody(request);
        const action = typeof body.action === 'string' ? body.action : '';
        if (!action) throw new WorkbenchError(400, 'ACTION_REQUIRED', '缺少 action。');

        const project = () => getProjectDetail(projectId);

        switch (action) {
            case 'design.save': {
                const result = saveDesignCard({
                    projectId,
                    card: body.card,
                    lockedFields: body.lockedFields
                });
                return workbenchJson({ ok: true, result, project: project() });
            }
            case 'design.update': {
                if (typeof body.instruction !== 'string') {
                    throw new WorkbenchError(400, 'INSTRUCTION_REQUIRED', '缺少修改要求。');
                }
                const result = await updateDesignFromInstruction({
                    projectId,
                    instruction: body.instruction,
                    confirmPlanner: body.confirmPlanner === true,
                    plannerModel: body.plannerModel,
                    reasoningEffort: body.reasoningEffort
                });
                return workbenchJson({ ok: true, result, project: project() });
            }
            case 'design.unlock': {
                const lockedFields = unlockFields(projectId, body.fields);
                return workbenchJson({ ok: true, lockedFields, project: project() });
            }
            case 'prompt.compile': {
                compileProjectPrompt(projectId);
                return workbenchJson({ ok: true, project: project() });
            }
            case 'prompt.saveManual': {
                if (typeof body.text !== 'string') {
                    throw new WorkbenchError(400, 'PROMPT_REQUIRED', '缺少主提示词。');
                }
                saveManualPrompt(projectId, {
                    text: body.text,
                    avoid: typeof body.avoid === 'string' ? body.avoid : '',
                    acceptance: typeof body.acceptance === 'string' ? body.acceptance : ''
                });
                return workbenchJson({ ok: true, project: project() });
            }
            case 'prompt.keepManual': {
                keepManualPrompt(projectId);
                return workbenchJson({ ok: true, project: project() });
            }
            case 'assets.analyze': {
                if (typeof body.assetId !== 'string') {
                    throw new WorkbenchError(400, 'ASSET_ID_REQUIRED', '缺少素材 ID。');
                }
                const result = await analyzeAsset({
                    projectId,
                    assetId: body.assetId,
                    confirmAnalysis: body.confirmAnalysis === true
                });
                return workbenchJson({ ok: true, ...result, project: project() });
            }
            case 'assets.upload': {
                if (typeof body.base64 !== 'string' || typeof body.originalName !== 'string') {
                    throw new WorkbenchError(400, 'UPLOAD_PAYLOAD_REQUIRED', '缺少文件内容或文件名。');
                }
                const bytes = Buffer.from(body.base64, 'base64');
                const asset = await uploadAsset({
                    projectId,
                    bytes,
                    originalName: body.originalName,
                    declaredMime: typeof body.mime === 'string' ? body.mime : null
                });
                return workbenchJson({ ok: true, asset, project: project() });
            }
            case 'assets.updateAnalysis': {
                if (typeof body.assetId !== 'string') {
                    throw new WorkbenchError(400, 'ASSET_ID_REQUIRED', '缺少素材 ID。');
                }
                const result = updateAssetAnalysis({
                    projectId,
                    assetId: body.assetId,
                    analysis: body.analysis
                });
                return workbenchJson({ ok: true, ...result, project: project() });
            }
            case 'references.save': {
                const references = saveBindings({ projectId, bindings: body.bindings });
                return workbenchJson({ ok: true, references, project: project() });
            }
            case 'search.run': {
                const rawQueries = Array.isArray(body.queries) ? body.queries : [];
                const queries = rawQueries
                    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
                    .map((entry) => ({
                        kind: String(entry.kind ?? ''),
                        query: String(entry.query ?? '')
                    })) as { kind: 'official' | 'pose' | 'space' | 'style'; query: string }[];
                const result = await runSearch({
                    projectId,
                    queries,
                    confirmSearch: body.confirmSearch === true
                });
                return workbenchJson({ ok: true, ...result, project: project() });
            }
            case 'candidate.import': {
                if (typeof body.candidateId !== 'string') {
                    throw new WorkbenchError(400, 'CANDIDATE_ID_REQUIRED', '缺少候选图 ID。');
                }
                const asset = await importCandidate({ projectId, candidateId: body.candidateId });
                return workbenchJson({ ok: true, asset, project: project() });
            }
            case 'run.estimate': {
                const runBody = (body.run && typeof body.run === 'object' ? body.run : {}) as Partial<CreateRunInput>;
                const preview = estimateRunPreview({ projectId, body: runBody });
                return workbenchJson({ ok: true, preview });
            }
            case 'run.create': {
                const runBody = (body.run && typeof body.run === 'object' ? body.run : {}) as Partial<CreateRunInput>;
                const actionId = typeof body.actionId === 'string' ? body.actionId : undefined;
                const runAction = runBody.action ?? 'generate';
                if (runAction !== 'generate' && runAction !== 'revise' && runAction !== 'reroll') {
                    throw new WorkbenchError(400, 'INVALID_RUN_ACTION', `不支持的运行类型：${String(runAction)}`);
                }
                if (runAction === 'revise') {
                    const result = await createRevisionRun({
                        projectId,
                        actionId,
                        body: runBody as CreateRunInput & { baseVersionId?: string; changePoints?: string[]; keepPoints?: string[] }
                    });
                    return workbenchJson({ ok: true, run: result.run, reused: result.reused, project: project() });
                }
                if (runAction === 'reroll') {
                    if (typeof runBody.sourceRunId !== 'string') {
                        throw new WorkbenchError(400, 'SOURCE_RUN_REQUIRED', '缺少要复用的运行 ID。');
                    }
                    const result = await createRerollRun({
                        projectId,
                        actionId,
                        sourceRunId: runBody.sourceRunId,
                        imageCount: runBody.imageCount,
                        budgetUsd: Number(runBody.budgetUsd),
                        riskAcknowledged: runBody.riskAcknowledged === true
                    });
                    return workbenchJson({ ok: true, run: result.run, reused: result.reused, project: project() });
                }
                const result = await createGenerationRun({ projectId, actionId, body: runBody as CreateRunInput });
                return workbenchJson({ ok: true, run: result.run, reused: result.reused, project: project() });
            }
            case 'run.stop': {
                if (typeof body.runId !== 'string') throw new WorkbenchError(400, 'RUN_ID_REQUIRED', '缺少运行 ID。');
                const run = stopRunAction(body.runId);
                return workbenchJson({ ok: true, run, project: project() });
            }
            case 'run.abandonUnknown': {
                if (typeof body.runId !== 'string') throw new WorkbenchError(400, 'RUN_ID_REQUIRED', '缺少运行 ID。');
                const run = abandonUnknownAction(body.runId);
                return workbenchJson({ ok: true, run, project: project() });
            }
            case 'project.fork': {
                const forked = await forkProject({
                    projectId,
                    instruction: typeof body.instruction === 'string' ? body.instruction : '',
                    confirmPlanner: body.confirmPlanner === true,
                    plannerModel: body.plannerModel,
                    reasoningEffort: body.reasoningEffort
                });
                return workbenchJson({ ok: true, project: forked });
            }
            case 'project.rename': {
                if (typeof body.name !== 'string') throw new WorkbenchError(400, 'NAME_REQUIRED', '缺少项目名。');
                updateProjectName(projectId, body.name);
                return workbenchJson({ ok: true, project: project() });
            }
            case 'version.baseline': {
                if (typeof body.versionId !== 'string') {
                    throw new WorkbenchError(400, 'VERSION_ID_REQUIRED', '缺少版本 ID。');
                }
                const version = setBaselineAction(projectId, body.versionId);
                return workbenchJson({ ok: true, version, project: project() });
            }
            case 'asset.get': {
                if (typeof body.assetId !== 'string') throw new WorkbenchError(400, 'ASSET_ID_REQUIRED', '缺少素材 ID。');
                const asset = getAsset(body.assetId);
                if (!asset) throw new WorkbenchError(404, 'ASSET_NOT_FOUND', '素材不存在。');
                return workbenchJson({ ok: true, asset });
            }
            default:
                throw new WorkbenchError(400, 'UNKNOWN_ACTION', `未知 action：${action}`);
        }
    } catch (error) {
        return errorResponse(error);
    } finally {
        release?.();
    }
}
