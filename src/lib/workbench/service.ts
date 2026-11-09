import { getImageApiConfiguration } from '@/lib/server/image-api';
import { validateCustomSize } from '@/lib/size-utils';
import { decodeImage, saveAssetFromBytes } from '@/lib/workbench/assets';
import {
    getAnalysisModel,
    getCandidateDir,
    getDefaultImageModel,
    getLimits,
    getPlannerModel,
    getPlannerModels,
    getPlannerReasoningEffort,
    getReviewModel,
    getSearchModel,
    getWorkerToken,
    isLoopbackTestDownloadAllowed,
    isStrictAuthorizationTest,
    isWorkbenchFixtureTest,
    PLANNER_REASONING_EFFORTS,
    PRICE_TABLE_SOURCE,
    PRICE_TABLE_VERSION,
    type PlannerReasoningEffort
} from '@/lib/workbench/config';
import { buildCostEstimate } from '@/lib/workbench/estimate';
import { SafeDownloadError, safeDownloadImage } from '@/lib/workbench/fetcher';
import { createDesignDraft, updateDesign } from '@/lib/workbench/planner';
import { compilePrompt } from '@/lib/workbench/prompt';
import {
    computeDesignDiff,
    isDesignFieldKey,
    isReferencePurposeValue,
    parseAnalysis,
    sanitizeDesignCard
} from '@/lib/workbench/schema';
import { searchImages, type SearchQuery } from '@/lib/workbench/search';
import {
    abandonUnknownItems,
    applyDesignCard,
    bindingHash,
    createProject,
    createRun,
    getAsset,
    getCandidate,
    getProjectData,
    getRun,
    getRunByActionKey,
    getVersion,
    getWorkerHeartbeat,
    listLibraryAssets,
    listProjects,
    nowIso,
    replaceBindings,
    setAssetAnalysis,
    setBaseline,
    setProjectName,
    setPromptState,
    skipPendingItems,
    unlockDesignFields,
    updateCandidate,
    updateRunState,
    finalizeRunStatus,
    type StoredProject
} from '@/lib/workbench/store';
import {
    type AssetMeta,
    type CreateRunInput,
    type DesignFieldKey,
    type DesignUpdateResult,
    type ProjectDetail,
    type ProjectSummary,
    type ReferenceBinding,
    type ReferencePurpose,
    type RunSnapshot,
    type RunSummary,
    type VersionRecord,
    type WorkbenchStatus
} from '@/lib/workbench/types';
import { analyzeReference } from '@/lib/workbench/vision';
import {
    GPT_IMAGE_MODELS,
    isGptImageModel,
    supportsExtendedQuality,
    type GptImageModel,
    type ImageBackground,
    type ImageModeration,
    type ImageOutputFormat,
    type ImageQuality
} from '@/lib/models';
import path from 'node:path';

export class WorkbenchError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details?: unknown;

    constructor(status: number, code: string, message: string, details?: unknown) {
        super(message);
        this.name = 'WorkbenchError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

const QUALITIES: readonly ImageQuality[] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
const BACKGROUNDS: readonly ImageBackground[] = ['auto', 'opaque', 'transparent'];
const MODERATIONS: readonly ImageModeration[] = ['auto', 'low'];
const OUTPUT_FORMATS: readonly ImageOutputFormat[] = ['png', 'jpeg', 'webp'];

export function getWorkbenchStatus(): WorkbenchStatus {
    const imageApi = getImageApiConfiguration();
    const heartbeat = getWorkerHeartbeat();
    return {
        imageApiEnabled: imageApi.enabled,
        apiKeyConfigured: imageApi.apiKeyConfigured,
        plannerModel: getPlannerModel(),
        plannerModels: getPlannerModels(),
        plannerReasoningEffort: getPlannerReasoningEffort(),
        plannerReasoningEfforts: [...PLANNER_REASONING_EFFORTS],
        searchModel: getSearchModel(),
        reviewModel: getReviewModel(),
        analysisModel: getAnalysisModel(),
        defaultImageModel: getDefaultImageModel(),
        models: {
            image: [...GPT_IMAGE_MODELS],
            quality: [...QUALITIES]
        },
        limits: getLimits(),
        priceTable: {
            version: PRICE_TABLE_VERSION,
            source: PRICE_TABLE_SOURCE,
            updatedAt: '2026-11-06'
        },
        worker: {
            tokenConfigured: !!getWorkerToken(),
            lastTickAt: heartbeat?.tickAt ?? null
        }
    };
}

export function listProjectsWithStatus(): { projects: ProjectSummary[]; status: WorkbenchStatus } {
    return { projects: listProjects().filter((project) => !project.mock || isWorkbenchFixtureTest()), status: getWorkbenchStatus() };
}

export function getProjectDetail(projectId: string): ProjectDetail | null {
    const data = getProjectData(projectId);
    if (!data || (data.project.mock && !isWorkbenchFixtureTest())) return null;
    return { ...data, status: getWorkbenchStatus() };
}

function requireProject(projectId: string): StoredProject {
    const project = getProjectData(projectId);
    if (!project) throw new WorkbenchError(404, 'PROJECT_NOT_FOUND', '项目不存在。');
    if (project.project.mock && !isWorkbenchFixtureTest()) {
        throw new WorkbenchError(409, 'TEST_DATA_NOT_EXECUTABLE', '历史测试项目已隔离，不能发起真实调用；原始数据仍保留。');
    }
    return project;
}

function isFixtureProject(project: StoredProject): boolean {
    if ((project.project.mock || project.references.some((reference) => reference.asset.mock)) && !isWorkbenchFixtureTest()) {
        throw new WorkbenchError(409, 'TEST_DATA_NOT_EXECUTABLE', '历史测试项目不能发起真实调用。');
    }
    return isWorkbenchFixtureTest();
}

function resolvePlannerSettings(input: { plannerModel?: unknown; reasoningEffort?: unknown }): {
    model: string;
    reasoningEffort: PlannerReasoningEffort;
} {
    const model =
        typeof input.plannerModel === 'string' && input.plannerModel.trim()
            ? input.plannerModel.trim()
            : getPlannerModel();
    const allowed = getPlannerModels();
    if (!allowed.includes(model)) {
        throw new WorkbenchError(
            400,
            'INVALID_PLANNER_MODEL',
            `规划模型不在允许列表：${model}。允许：${allowed.join(', ')}；可通过 WORKBENCH_PLANNER_MODELS 扩展。`
        );
    }
    const rawEffort =
        typeof input.reasoningEffort === 'string' && input.reasoningEffort.trim()
            ? input.reasoningEffort.trim()
            : getPlannerReasoningEffort();
    if (!(PLANNER_REASONING_EFFORTS as readonly string[]).includes(rawEffort)) {
        throw new WorkbenchError(
            400,
            'INVALID_REASONING_EFFORT',
            `不支持的思考强度：${rawEffort}。支持：${PLANNER_REASONING_EFFORTS.join(', ')}`
        );
    }
    return { model, reasoningEffort: rawEffort as PlannerReasoningEffort };
}

function requirePaidConfirmation(confirmed: boolean, actionLabel: string, detail: string) {
    if (!confirmed) {
        throw new WorkbenchError(
            402,
            'PAID_ACTION_NOT_CONFIRMED',
            `${actionLabel}会产生真实 API 调用，费用${detail}。请确认后再执行。`
        );
    }
}

export async function createProjectFromInput(input: {
    text: string;
    entry: 'keyword' | 'upload';
    confirmPlanner: boolean;
    hasUpload?: boolean;
    plannerModel?: unknown;
    reasoningEffort?: unknown;
}): Promise<ProjectDetail> {
    const text = input.text.trim();
    if (text.length < 2) throw new WorkbenchError(400, 'INPUT_REQUIRED', '请输入至少两个字符的创作方向。');
    if (text.length > 4000) throw new WorkbenchError(400, 'INPUT_TOO_LONG', '输入过长，请精简到 4000 字符以内。');
    requirePaidConfirmation(input.confirmPlanner, '整理设计方向（1 次规划调用）', '未知（规划文本模型价格未配置）');
    const planner = resolvePlannerSettings(input);

    const mock = isWorkbenchFixtureTest();
    const draft = await createDesignDraft({
        text,
        entry: input.entry,
        hasUpload: !!input.hasUpload,
        mock,
        model: planner.model,
        reasoningEffort: planner.reasoningEffort
    });
    const id = createProject({
        name: draft.name,
        entry: input.entry,
        design: draft.card,
        lockedFields: [],
        mock,
        plannerModel: planner.model,
        reasoningEffort: planner.reasoningEffort
    });
    return getProjectDetail(id)!;
}

export function updateProjectName(projectId: string, name: string) {
    requireProject(projectId);
    const trimmed = name.trim();
    if (!trimmed) throw new WorkbenchError(400, 'NAME_REQUIRED', '项目名不能为空。');
    setProjectName(projectId, trimmed.slice(0, 80));
}

export function saveDesignCard(input: {
    projectId: string;
    card: unknown;
    lockedFields: unknown;
}): DesignUpdateResult {
    const project = requireProject(input.projectId);
    const card = sanitizeDesignCard(input.card);
    const locked = Array.isArray(input.lockedFields)
        ? input.lockedFields.filter(isDesignFieldKey)
        : project.lockedFields;

    const diff = computeDesignDiff(project.design, card);
    applyDesignCard({
        projectId: input.projectId,
        card,
        lockedFields: locked,
        instruction: null,
        changes: diff,
        conflicts: []
    });
    return {
        card,
        changeSummary: diff,
        conflicts: [],
        requiresUnlock: []
    };
}

export async function updateDesignFromInstruction(input: {
    projectId: string;
    instruction: string;
    confirmPlanner: boolean;
    plannerModel?: unknown;
    reasoningEffort?: unknown;
}): Promise<DesignUpdateResult & { model: string; reasoningEffort: PlannerReasoningEffort }> {
    const project = requireProject(input.projectId);
    const instruction = input.instruction.trim();
    if (instruction.length < 2) throw new WorkbenchError(400, 'INSTRUCTION_REQUIRED', '请输入修改要求。');
    requirePaidConfirmation(input.confirmPlanner, '按自然语言修改设计（1 次规划调用）', '未知（规划文本模型价格未配置）');
    const planner = resolvePlannerSettings(input);

    const result = await updateDesign({
        instruction,
        current: project.design,
        lockedFields: project.lockedFields,
        references: project.references,
        mock: isFixtureProject(project),
        model: planner.model,
        reasoningEffort: planner.reasoningEffort
    });

    applyDesignCard({
        projectId: input.projectId,
        card: result.card,
        lockedFields: project.lockedFields,
        instruction,
        changes: result.changeSummary,
        conflicts: result.conflicts,
        plannerModel: planner.model,
        reasoningEffort: planner.reasoningEffort
    });
    return result;
}

export function unlockFields(projectId: string, fields: unknown): DesignFieldKey[] {
    requireProject(projectId);
    const keys = Array.isArray(fields) ? fields.filter(isDesignFieldKey) : [];
    if (keys.length === 0) throw new WorkbenchError(400, 'FIELDS_REQUIRED', '请选择要解锁的字段。');
    return unlockDesignFields(projectId, keys);
}

export async function uploadAsset(input: {
    projectId: string;
    bytes: Buffer;
    originalName: string;
    declaredMime?: string | null;
}): Promise<AssetMeta> {
    const project = requireProject(input.projectId);
    const limits = getLimits();
    if (input.bytes.length > limits.maxUploadBytes) {
        throw new WorkbenchError(413, 'FILE_TOO_LARGE', `文件超过 ${limits.maxUploadBytes} 字节限制。`);
    }
    const { asset } = await saveAssetFromBytes({
        bytes: input.bytes,
        originalName: input.originalName,
        kind: 'upload',
        projectId: project.project.id,
        mock: isFixtureProject(project),
        declaredMime: input.declaredMime
    });
    return asset;
}

export async function analyzeAsset(input: {
    projectId: string;
    assetId: string;
    confirmAnalysis: boolean;
}) {
    const project = requireProject(input.projectId);
    if (!project.assets.some((asset) => asset.id === input.assetId)) {
        const asset = getAsset(input.assetId);
        if (!asset) throw new WorkbenchError(404, 'ASSET_NOT_FOUND', '素材不存在。');
    }
    const asset = getAsset(input.assetId);
    if (!asset) throw new WorkbenchError(404, 'ASSET_NOT_FOUND', '素材不存在。');
    if (asset.mock && !isWorkbenchFixtureTest()) throw new WorkbenchError(409, 'TEST_DATA_NOT_EXECUTABLE', '历史测试素材不能发送到真实模型。');
    requirePaidConfirmation(
        input.confirmAnalysis,
        '视觉分析参考图（1 次视觉模型调用）',
        '未知（视觉模型价格未配置）'
    );
    const analysis = await analyzeReference({ asset, mock: isFixtureProject(project) });
    return { analysis, asset: getAsset(input.assetId)! };
}

export function updateAssetAnalysis(input: { projectId: string; assetId: string; analysis: unknown }) {
    requireProject(input.projectId);
    const asset = getAsset(input.assetId);
    if (!asset) throw new WorkbenchError(404, 'ASSET_NOT_FOUND', '素材不存在。');
    const raw = input.analysis && typeof input.analysis === 'object' ? (input.analysis as Record<string, unknown>) : {};
    const analysis = parseAnalysis({
        ...raw,
        suggestedPurpose: isReferencePurposeValue(raw.suggestedPurpose)
            ? raw.suggestedPurpose
            : asset.analysis?.suggestedPurpose ?? 'style',
        model: 'manual-edit',
        analyzedAt: nowIso(),
        cacheKey: 'manual'
    });
    setAssetAnalysis(input.assetId, 'manual', analysis);
    return { analysis, asset: getAsset(input.assetId)! };
}

export function saveBindings(input: {
    projectId: string;
    bindings: unknown;
}): ReferenceBinding[] {
    const project = requireProject(input.projectId);
    if (!Array.isArray(input.bindings)) throw new WorkbenchError(400, 'INVALID_BINDINGS', '参考组格式错误。');
    const limits = getLimits();

    const seen = new Set<string>();
    const normalized: {
        assetId: string;
        purpose: ReferencePurpose;
        borrow: string;
        exclude: string;
        position: number;
    }[] = [];

    input.bindings.forEach((raw, index) => {
        if (!raw || typeof raw !== 'object') return;
        const record = raw as Record<string, unknown>;
        const assetId = typeof record.assetId === 'string' ? record.assetId : '';
        if (!assetId || seen.has(assetId)) return;
        const asset = getAsset(assetId);
        if (!asset) return;
        if (asset.mock && !isWorkbenchFixtureTest()) {
            throw new WorkbenchError(409, 'TEST_DATA_NOT_EXECUTABLE', '历史测试素材不能绑定到真实项目。');
        }
        seen.add(assetId);
        const purpose = isReferencePurposeValue(record.purpose) ? record.purpose : 'style';
        normalized.push({
            assetId,
            purpose,
            borrow: typeof record.borrow === 'string' ? record.borrow.slice(0, 500) : '',
            exclude: typeof record.exclude === 'string' ? record.exclude.slice(0, 500) : '',
            position: index
        });
    });

    if (normalized.length > limits.maxReferenceImages) {
        throw new WorkbenchError(400, 'TOO_MANY_REFERENCES', `参考图最多 ${limits.maxReferenceImages} 张。`);
    }
    replaceBindings(input.projectId, normalized);
    return requireProject(input.projectId).references;
}

export function compileProjectPrompt(projectId: string): void {
    const project = requireProject(projectId);
    const compiled = compilePrompt({
        design: project.design,
        lockedFields: project.lockedFields,
        references: project.references
    });
    setPromptState(projectId, {
        ...compiled,
        source: 'compiled',
        designVersion: project.project.designVersion,
        bindingHash: bindingHash(projectId),
        stale: false
    });
}

export function saveManualPrompt(projectId: string, prompt: { text: string; avoid: string; acceptance: string }) {
    const project = requireProject(projectId);
    if (!prompt.text.trim()) throw new WorkbenchError(400, 'PROMPT_REQUIRED', '主提示词不能为空。');
    setPromptState(projectId, {
        text: prompt.text.slice(0, 20000),
        avoid: prompt.avoid.slice(0, 4000),
        acceptance: prompt.acceptance.slice(0, 4000),
        source: 'manual',
        designVersion: project.project.designVersion,
        bindingHash: bindingHash(projectId),
        stale: false
    });
}

export function keepManualPrompt(projectId: string) {
    const project = requireProject(projectId);
    setPromptState(projectId, {
        ...project.prompt,
        source: 'manual',
        designVersion: project.project.designVersion,
        bindingHash: bindingHash(projectId),
        stale: false
    });
}

export async function runSearch(input: {
    projectId: string;
    queries: SearchQuery[];
    confirmSearch: boolean;
}) {
    const project = requireProject(input.projectId);
    requirePaidConfirmation(
        input.confirmSearch,
        `联网搜图（最多 ${Math.min(input.queries.length, getLimits().maxSearchQueries)} 次搜索调用）`,
        '未知（搜索模型价格未配置）'
    );
    return searchImages({
        projectId: input.projectId,
        queries: input.queries,
        mock: isFixtureProject(project)
    });
}

export async function importCandidate(input: { projectId: string; candidateId: string }): Promise<AssetMeta> {
    const project = requireProject(input.projectId);
    const candidate = getCandidate(input.candidateId);
    if (!candidate || candidate.projectId !== input.projectId) {
        throw new WorkbenchError(404, 'CANDIDATE_NOT_FOUND', '候选图不存在。');
    }
    if (candidate.mock && !isWorkbenchFixtureTest()) {
        throw new WorkbenchError(409, 'TEST_DATA_NOT_EXECUTABLE', '历史测试候选图不能导入真实项目。');
    }
    if (candidate.assetId) {
        const existing = getAsset(candidate.assetId);
        if (existing) return existing;
    }

    try {
        let bytes: Buffer;
        let originalName = `search-${candidate.id.slice(0, 8)}.png`;

        if (candidate.mock && isWorkbenchFixtureTest()) {
            const filename = path.basename(new URL(candidate.imageUrl, 'http://127.0.0.1').pathname);
            const filepath = path.join(/*turbopackIgnore: true*/ getCandidateDir(), filename);
            const fs = await import('node:fs/promises');
            bytes = await fs.readFile(filepath);
            originalName = filename;
            await decodeImage(bytes);
        } else {
            const download = await safeDownloadImage(candidate.imageUrl, {
                allowLoopback: isLoopbackTestDownloadAllowed()
            });
            bytes = download.bytes;
            const ext = download.mime === 'image/png' ? 'png' : download.mime === 'image/webp' ? 'webp' : 'jpg';
            originalName = `search-${candidate.id.slice(0, 8)}.${ext}`;
        }

        const { asset } = await saveAssetFromBytes({
            bytes,
            originalName,
            kind: 'search',
            projectId: project.project.id,
            sourcePage: candidate.pageUrl,
            sourceUrl: candidate.imageUrl,
            mock: candidate.mock
        });
        updateCandidate(candidate.id, { status: 'imported', assetId: asset.id, error: null });
        return asset;
    } catch (error) {
        const message = error instanceof SafeDownloadError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
        updateCandidate(candidate.id, { status: 'failed', error: message });
        throw new WorkbenchError(422, 'CANDIDATE_IMPORT_FAILED', `候选图导入失败：${message}`, { candidateId: candidate.id });
    }
}

export function libraryAssets(): AssetMeta[] {
    return listLibraryAssets().filter((asset) => !asset.mock || isWorkbenchFixtureTest());
}

function normalizeParams(input: Partial<CreateRunInput>) {
    const model = input.model ?? getDefaultImageModel();
    if (!isGptImageModel(model)) throw new WorkbenchError(400, 'INVALID_MODEL', `不支持的模型：${model}`);
    if (!supportsExtendedQuality(model) && (input.quality === 'xhigh' || input.quality === 'max')) {
        throw new WorkbenchError(400, 'INVALID_QUALITY', `${model} 不支持该质量档位。`);
    }
    const quality = input.quality ?? 'high';
    if (!QUALITIES.includes(quality as ImageQuality)) {
        throw new WorkbenchError(400, 'INVALID_QUALITY', `不支持的质量档位：${quality}`);
    }
    const size = input.size ?? '2048x1152';
    if (size !== 'auto') {
        const match = /^(\d+)x(\d+)$/.exec(size);
        if (!match) throw new WorkbenchError(400, 'INVALID_SIZE', '尺寸必须是 auto 或 WIDTHxHEIGHT。');
        const validation = validateCustomSize(Number(match[1]), Number(match[2]));
        if (!validation.valid) throw new WorkbenchError(400, 'INVALID_SIZE', validation.reason);
    }
    const background = input.background ?? 'auto';
    if (!BACKGROUNDS.includes(background)) throw new WorkbenchError(400, 'INVALID_BACKGROUND', '背景参数无效。');
    const moderation = input.moderation ?? 'auto';
    if (!MODERATIONS.includes(moderation)) throw new WorkbenchError(400, 'INVALID_MODERATION', '审核参数无效。');
    const outputFormat = (input.outputFormat ?? 'png') as ImageOutputFormat;
    if (!OUTPUT_FORMATS.includes(outputFormat)) throw new WorkbenchError(400, 'INVALID_FORMAT', '输出格式无效。');
    if (background === 'transparent' && outputFormat !== 'png') {
        throw new WorkbenchError(400, 'TRANSPARENT_REQUIRES_PNG', '透明背景只能输出 PNG。');
    }
    const imageCount: 1 | 2 = input.imageCount === 2 ? 2 : 1;
    return { model: model as GptImageModel, quality, size, background, moderation, outputFormat, imageCount };
}

function buildAuthorization(input: {
    estimate: ReturnType<typeof buildCostEstimate>;
    budgetUsd: number;
    riskAcknowledged: boolean;
    mock: boolean;
}) {
    const enforceRealAuthorization = !input.mock || isStrictAuthorizationTest();
    if (!Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0) {
        throw new WorkbenchError(400, 'INVALID_BUDGET', '预算必须是大于 0 的数字。');
    }
    if (enforceRealAuthorization && !input.riskAcknowledged) {
        throw new WorkbenchError(
            402,
            'RISK_NOT_ACKNOWLEDGED',
            '本次包含审稿调用，文本模型费用未知；请勾选风险确认后再提交。'
        );
    }
    if (input.estimate.estimatedImageUsd === null && !input.riskAcknowledged) {
        throw new WorkbenchError(402, 'COST_UNKNOWN', '图片生成费用无法估计，需明确风险授权后才能执行。');
    }
    const perImage =
        input.estimate.estimatedImageUsd !== null && input.estimate.imageCalls > 0
            ? input.estimate.estimatedImageUsd / input.estimate.imageCalls
            : null;
    if (perImage !== null && input.budgetUsd + 1e-9 < perImage) {
        throw new WorkbenchError(
            400,
            'BUDGET_TOO_LOW',
            `预算不足以覆盖单张图片的估算费用（约 $${perImage.toFixed(4)}）。`
        );
    }
    return {
        approvedByUser: true,
        approvedAt: nowIso(),
        maxCalls: input.estimate.totalCalls,
        maxImageOutputs: input.estimate.imageCalls,
        budgetUsd: Math.round(input.budgetUsd * 10000) / 10000,
        riskAcknowledged: enforceRealAuthorization ? input.riskAcknowledged : true
    };
}

function actionKey(actionId: string | undefined): string {
    if (!actionId || !/^[a-zA-Z0-9-]{8,80}$/.test(actionId)) {
        throw new WorkbenchError(400, 'ACTION_ID_REQUIRED', '缺少或非法的客户端动作 ID；无法防重复提交。');
    }
    return actionId;
}

export function estimateRunPreview(input: { projectId: string; body: Partial<CreateRunInput> }) {
    const project = requireProject(input.projectId);
    const mock = isFixtureProject(project);
    const params = normalizeParams(input.body);
    const prompt = project.prompt.text.trim()
        ? project.prompt
        : {
              ...project.prompt,
              ...compilePrompt({
                  design: project.design,
                  lockedFields: project.lockedFields,
                  references: project.references
              })
          };
    const estimate = buildCostEstimate({
        model: params.model,
        size: params.size,
        quality: params.quality,
        imageCount: params.imageCount,
        promptChars: prompt.text.length + prompt.avoid.length,
        referencePixels: project.references.map((binding) => binding.asset.width * binding.asset.height),
        mock
    });
    const perImage =
        estimate.estimatedImageUsd !== null && estimate.imageCalls > 0
            ? estimate.estimatedImageUsd / estimate.imageCalls
            : null;
    return {
        estimate,
        params,
        mock,
        promptStale: project.prompt.stale,
        referenceCount: project.references.length,
        riskRequired: !mock,
        budgetMinUsd: perImage,
        note: '此预览不发送任何模型请求；实际提交时服务端会重新计算并校验。'
    };
}

export async function createGenerationRun(input: {
    projectId: string;
    actionId?: string;
    body: CreateRunInput;
}): Promise<{ run: RunSummary; reused: boolean }> {
    const project = requireProject(input.projectId);
    const key = actionKey(input.actionId);
    const existing = getRunByActionKey(key);
    if (existing) {
        if (existing.projectId !== input.projectId) {
            throw new WorkbenchError(409, 'ACTION_KEY_CONFLICT', '该动作 ID 已属于另一个项目。');
        }
        return { run: existing, reused: true };
    }

    const mock = isFixtureProject(project);
    const params = normalizeParams(input.body);

    let prompt = project.prompt;
    if (!prompt.text.trim()) {
        compileProjectPrompt(input.projectId);
        prompt = requireProject(input.projectId).prompt;
    }
    if (prompt.stale) {
        throw new WorkbenchError(409, 'PROMPT_STALE', '提示词已过期：请保留手动版或重新编译后确认。');
    }
    const references = project.references;
    if (references.length > getLimits().maxReferenceImages) {
        throw new WorkbenchError(400, 'TOO_MANY_REFERENCES', '参考图数量超过限制。');
    }

    const estimate = buildCostEstimate({
        model: params.model,
        size: params.size,
        quality: params.quality,
        imageCount: params.imageCount,
        promptChars: prompt.text.length + prompt.avoid.length,
        referencePixels: references.map((binding) => binding.asset.width * binding.asset.height),
        mock
    });
    const authorization = buildAuthorization({
        estimate,
        budgetUsd: input.body.budgetUsd,
        riskAcknowledged: input.body.riskAcknowledged,
        mock
    });

    const snapshot: RunSnapshot = {
        designCard: project.design,
        lockedFields: project.lockedFields,
        prompt: prompt.text,
        avoid: prompt.avoid,
        acceptance: prompt.acceptance,
        references: references.map((binding) => ({
            assetId: binding.assetId,
            sha256: binding.asset.sha256,
            filename: binding.asset.filename,
            mime: binding.asset.mime,
            purpose: binding.purpose,
            borrow: binding.borrow,
            exclude: binding.exclude,
            position: binding.position
        })),
        params: {
            model: params.model,
            size: params.size,
            quality: params.quality,
            background: params.background,
            outputFormat: params.outputFormat,
            moderation: params.moderation,
            imageCount: params.imageCount
        },
        review: { enabled: true, model: getReviewModel() },
        operation: { action: 'generate' },
        estimate,
        authorization,
        plannerModel: null,
        mock
    };

    const created = createRun({
        projectId: input.projectId,
        action: 'generate',
        actionKey: key,
        snapshot,
        mock,
        imageCount: params.imageCount
    });
    return { run: created.run, reused: !created.created };
}

export async function createRevisionRun(input: {
    projectId: string;
    actionId?: string;
    body: CreateRunInput & { baseVersionId?: string; changePoints?: string[]; keepPoints?: string[] };
}): Promise<{ run: RunSummary; reused: boolean }> {
    const project = requireProject(input.projectId);
    const key = actionKey(input.actionId);
    const existing = getRunByActionKey(key);
    if (existing) {
        if (existing.projectId !== input.projectId) {
            throw new WorkbenchError(409, 'ACTION_KEY_CONFLICT', '该动作 ID 已属于另一个项目。');
        }
        return { run: existing, reused: true };
    }

    const mock = isFixtureProject(project);
    const baseVersionId = input.body.baseVersionId;
    if (!baseVersionId) throw new WorkbenchError(400, 'BASE_VERSION_REQUIRED', '请先选择要修订的结果。');
    const version = getVersion(baseVersionId);
    if (!version || version.projectId !== input.projectId) {
        throw new WorkbenchError(404, 'VERSION_NOT_FOUND', '修订基底不存在。');
    }
    if ((version.mock || version.asset.mock) && !isWorkbenchFixtureTest()) {
        throw new WorkbenchError(409, 'TEST_DATA_NOT_EXECUTABLE', '历史测试版本不能作为真实修订基底。');
    }
    const changePoints = (input.body.changePoints ?? []).map((item) => String(item).trim()).filter(Boolean);
    if (changePoints.length < 1 || changePoints.length > 2) {
        throw new WorkbenchError(400, 'CHANGE_POINTS_REQUIRED', '请填写 1–2 个明确的修改点。');
    }
    if (changePoints.some((item) => item.length > 500)) {
        throw new WorkbenchError(400, 'CHANGE_POINTS_TOO_LONG', '单个修改点不能超过 500 字符。');
    }
    const keepPoints = (input.body.keepPoints ?? []).map((item) => String(item).trim()).filter(Boolean).slice(0, 6);
    const baseRun = getRun(version.runId);
    if (!baseRun) throw new WorkbenchError(409, 'BASE_RUN_MISSING', '基底版本的运行记录缺失，无法修订。');

    const params = normalizeParams({ ...input.body, imageCount: 1 });
    const baseSnapshot = baseRun.snapshot;
    const prompt = [
        baseSnapshot.prompt,
        '',
        '【本次定向修订】',
        `以选定的版本 ${version.label} 作为编辑基底，参考图仅作辅助。`,
        `必须保留：${keepPoints.length > 0 ? keepPoints.join('；') : '基底与锁定项、未指定部分保持不变'}`,
        `仅修改：${changePoints.map((item, index) => `${index + 1}. ${item}`).join(' ')}`,
        '除上述修改点外，不要改变角色版本、服装结构、空间关系、构图和画风。'
    ].join('\n');

    const estimate = buildCostEstimate({
        model: params.model,
        size: params.size,
        quality: params.quality,
        imageCount: 1,
        promptChars: prompt.length,
        referencePixels: [
            version.asset.width * version.asset.height,
            ...baseSnapshot.references.map((item) => {
                const asset = getAsset(item.assetId);
                return asset ? asset.width * asset.height : 1024 * 1024;
            })
        ],
        mock
    });
    const authorization = buildAuthorization({
        estimate,
        budgetUsd: input.body.budgetUsd,
        riskAcknowledged: input.body.riskAcknowledged,
        mock
    });

    const snapshot: RunSnapshot = {
        ...baseSnapshot,
        prompt,
        avoid: `${baseSnapshot.avoid}；避免修改未指定的部分`,
        acceptance: `${baseSnapshot.acceptance}；修改点：${changePoints.join('；')}`,
        params: {
            model: params.model,
            size: params.size,
            quality: params.quality,
            background: params.background,
            outputFormat: params.outputFormat,
            moderation: params.moderation,
            imageCount: 1
        },
        operation: {
            action: 'revise',
            baseVersionId,
            changePoints,
            keepPoints
        },
        estimate,
        authorization,
        plannerModel: null,
        mock
    };

    const created = createRun({
        projectId: input.projectId,
        action: 'revise',
        actionKey: key,
        snapshot,
        sourceRunId: baseRun.id,
        baseVersionId,
        mock,
        imageCount: 1
    });
    return { run: created.run, reused: !created.created };
}

export async function createRerollRun(input: {
    projectId: string;
    actionId?: string;
    sourceRunId: string;
    imageCount?: 1 | 2;
    budgetUsd: number;
    riskAcknowledged: boolean;
}): Promise<{ run: RunSummary; reused: boolean }> {
    const project = requireProject(input.projectId);
    const key = actionKey(input.actionId);
    const existing = getRunByActionKey(key);
    if (existing) {
        if (existing.projectId !== input.projectId) {
            throw new WorkbenchError(409, 'ACTION_KEY_CONFLICT', '该动作 ID 已属于另一个项目。');
        }
        return { run: existing, reused: true };
    }

    const mock = isFixtureProject(project);
    const source = getRun(input.sourceRunId);
    if (!source || source.projectId !== input.projectId) {
        throw new WorkbenchError(404, 'SOURCE_RUN_NOT_FOUND', '指定的运行不存在。');
    }
    if ((source.mock || source.snapshot.mock) && !isWorkbenchFixtureTest()) {
        throw new WorkbenchError(409, 'TEST_DATA_NOT_EXECUTABLE', '历史测试任务不能作为真实再抽来源。');
    }
    if (source.action === 'revise') {
        throw new WorkbenchError(400, 'REROLL_UNSUPPORTED', '修订运行不能直接再抽；请从原始生成运行再抽，或对结果再修一版。');
    }

    const params = source.snapshot.params;
    const imageCount = input.imageCount === undefined ? params.imageCount : input.imageCount;
    if ((imageCount !== 1 && imageCount !== 2) || imageCount > params.imageCount) {
        throw new WorkbenchError(400, 'INVALID_IMAGE_COUNT', '再抽数量必须为 1 或 2，且不能超过原批次数量。');
    }
    const estimate = buildCostEstimate({
        model: params.model,
        size: params.size,
        quality: params.quality,
        imageCount,
        promptChars: source.snapshot.prompt.length + source.snapshot.avoid.length,
        referencePixels: source.snapshot.references.map((item) => {
            const asset = getAsset(item.assetId);
            return asset ? asset.width * asset.height : 1024 * 1024;
        }),
        mock
    });
    const authorization = buildAuthorization({
        estimate,
        budgetUsd: input.budgetUsd,
        riskAcknowledged: input.riskAcknowledged,
        mock
    });

    const snapshot: RunSnapshot = {
        ...source.snapshot,
        params: { ...params, imageCount },
        operation: { action: 'reroll', sourceRunId: source.id },
        estimate,
        authorization,
        mock
    };

    const created = createRun({
        projectId: input.projectId,
        action: 'reroll',
        actionKey: key,
        snapshot,
        sourceRunId: source.id,
        mock,
        imageCount
    });
    return { run: created.run, reused: !created.created };
}

export function stopRunAction(runId: string): RunSummary {
    const run = getRun(runId);
    if (!run) throw new WorkbenchError(404, 'RUN_NOT_FOUND', '运行不存在。');
    updateRunState(runId, {
        stopRequested: true,
        errorCode: null,
        errorMessage:
            '已请求停止；在途请求可能无法取消并继续计费，不承诺退款；晚到的成功结果仍会保存。'
    });
    finalizeRunStatus(runId);
    return getRun(runId)!;
}

export function abandonUnknownAction(runId: string): RunSummary {
    const run = getRun(runId);
    if (!run) throw new WorkbenchError(404, 'RUN_NOT_FOUND', '运行不存在。');
    if (run.status !== 'paused_unknown') {
        throw new WorkbenchError(409, 'NOT_PAUSED_UNKNOWN', '该运行不处于“结果未知”暂停状态。');
    }
    abandonUnknownItems(runId);
    updateRunState(runId, { status: 'running', errorCode: null, errorMessage: null });
    finalizeRunStatus(runId);
    return getRun(runId)!;
}

export function setBaselineAction(projectId: string, versionId: string): VersionRecord {
    requireProject(projectId);
    const version = getVersion(versionId);
    if (!version || version.projectId !== projectId) {
        throw new WorkbenchError(404, 'VERSION_NOT_FOUND', '版本不存在。');
    }
    setBaseline(projectId, versionId);
    return getVersion(versionId)!;
}

export async function forkProject(input: {
    projectId: string;
    instruction: string;
    confirmPlanner: boolean;
    plannerModel?: unknown;
    reasoningEffort?: unknown;
}): Promise<ProjectDetail> {
    const project = requireProject(input.projectId);
    const instruction = input.instruction.trim();
    if (instruction.length > 2000) throw new WorkbenchError(400, 'INSTRUCTION_TOO_LONG', '新方向说明过长。');
    if (instruction) {
        requirePaidConfirmation(input.confirmPlanner, '探索新方向（1 次规划调用）', '未知（规划文本模型价格未配置）');
    }
    const planner = resolvePlannerSettings(input);

    let card = project.design;
    if (instruction) {
        const result = await updateDesign({
            instruction,
            current: project.design,
            lockedFields: project.lockedFields,
            references: project.references.filter((binding) =>
                ['character', 'face', 'style'].includes(binding.purpose)
            ),
            mock: isFixtureProject(project),
            model: planner.model,
            reasoningEffort: planner.reasoningEffort
        });
        card = result.card;
    }

    const id = createProject({
        name: `${project.project.name} · 新方向`,
        entry: project.project.entry,
        design: card,
        lockedFields: project.lockedFields,
        mock: isFixtureProject(project),
        plannerModel: instruction ? planner.model : null,
        reasoningEffort: instruction ? planner.reasoningEffort : null
    });

    const copied = project.references
        .filter((binding) => ['character', 'face', 'style'].includes(binding.purpose))
        .map((binding, index) => ({
            assetId: binding.assetId,
            purpose: binding.purpose,
            borrow: binding.borrow,
            exclude: binding.exclude,
            position: index
        }));
    if (copied.length > 0) replaceBindings(id, copied);
    return getProjectDetail(id)!;
}

export function getVersionInfo(versionId: string) {
    const version = getVersion(versionId);
    if (!version) throw new WorkbenchError(404, 'VERSION_NOT_FOUND', '版本不存在。');
    const project = requireProject(version.projectId);
    const run = getRun(version.runId);
    const snapshot = run?.snapshot;
    const item = run?.items.find((entry) => entry.versionId === version.id);
    return {
        schema: 'local-creative-workbench/version-info/v1',
        generatedAt: nowIso(),
        disclosed: '此文件不含 API Key 或环境密钥。',
        project: { id: project.project.id, name: project.project.name, mock: project.project.mock },
        version: {
            id: version.id,
            label: version.label,
            parentVersionId: version.parentVersionId,
            baseline: version.isBaseline,
            createdAt: version.createdAt,
            mock: version.mock
        },
        asset: {
            id: version.asset.id,
            originalName: version.asset.originalName,
            sha256: version.asset.sha256,
            width: version.asset.width,
            height: version.asset.height,
            bytes: version.asset.bytes,
            mime: version.asset.mime
        },
        run: run
            ? {
                  id: run.id,
                  action: run.action,
                  status: run.status,
                  createdAt: run.createdAt,
                  requestId: item?.requestId ?? null,
                  openaiRequestId: item?.openaiRequestId ?? null,
                  usage: item?.usage ?? null,
                  estimatedCostUsd: item?.estimatedCostUsd ?? null
              }
            : null,
        prompt: snapshot
            ? { text: snapshot.prompt, avoid: snapshot.avoid, acceptance: snapshot.acceptance }
            : null,
        design: snapshot?.designCard ?? project.design,
        lockedFields: snapshot?.lockedFields ?? project.lockedFields,
        references: snapshot?.references ?? [],
        params: snapshot?.params ?? null,
        authorization: snapshot?.authorization ?? null,
        estimate: snapshot?.estimate ?? null,
        review: version.review,
        note: '用量为供应商返回；费用为按本地价格表计算的估算，不是账单；未知费用不写为 0。'
    };
}

export function versionForDownload(versionId: string): { version: VersionRecord; project: ProjectSummary } {
    const version = getVersion(versionId);
    if (!version) throw new WorkbenchError(404, 'VERSION_NOT_FOUND', '版本不存在。');
    const project = requireProject(version.projectId);
    return { version, project: project.project };
}

