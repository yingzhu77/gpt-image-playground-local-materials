import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DATA_DIR = '.workbench-data';
export const PRICE_TABLE_VERSION = 'v1-2026-11-06';
export const PRICE_TABLE_SOURCE = '应用内 cost-utils 模型费率（参考官方价格页整理，非账单）';

export function getWorkbenchDataDir(): string {
    const configured = process.env.WORKBENCH_DATA_DIR?.trim();
    const resolved = path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured || DEFAULT_DATA_DIR);
    return resolved;
}

export function getAssetsDir(): string {
    return path.join(/*turbopackIgnore: true*/ getWorkbenchDataDir(), 'assets');
}

export function getCandidateDir(): string {
    return path.join(/*turbopackIgnore: true*/ getWorkbenchDataDir(), 'candidates');
}

export function getDatabasePath(): string {
    return path.join(/*turbopackIgnore: true*/ getWorkbenchDataDir(), 'workbench.sqlite');
}

export function getWorkerTokenPath(): string {
    return path.join(/*turbopackIgnore: true*/ getWorkbenchDataDir(), 'worker-token');
}

export function isWorkbenchFixtureTest(): boolean {
    if (['1', 'true'].includes(String(process.env.WORKBENCH_MOCK ?? '').toLowerCase())) {
        throw new Error('模拟运行模式已移除；请移除 WORKBENCH_MOCK 后重新启动。本次不会转为真实调用。');
    }
    if (process.env.WORKBENCH_TEST_FIXTURES !== '1') return false;
    const configured = process.env.WORKBENCH_DATA_DIR?.trim();
    const testRoot = path.resolve(/*turbopackIgnore: true*/ process.cwd(), 'test-artifacts');
    const target = configured ? path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured) : '';
    const relative = target ? path.relative(testRoot, target) : '..';
    if (
        process.env.NODE_ENV === 'production' ||
        process.env.WORKBENCH_TEST_STRICT_AUTHORIZATION !== '1' ||
        process.env.OPENAI_API_KEY !== '' ||
        !configured || !relative || relative.startsWith('..') || path.isAbsolute(relative)
    ) {
        throw new Error('测试夹具仅允许在非生产环境、空 Key、严格授权及 test-artifacts 独立数据目录下运行。');
    }
    return true;
}

export function isStrictAuthorizationTest(): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    return process.env.WORKBENCH_TEST_STRICT_AUTHORIZATION === '1';
}

export function getPlannerModel(): string {
    return process.env.WORKBENCH_PLANNER_MODEL?.trim() || 'gpt-6.1-sol';
}

export function getPlannerModels(): string[] {
    const configured = process.env.WORKBENCH_PLANNER_MODELS?.split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const list = configured && configured.length > 0 ? configured : [getPlannerModel(), 'gpt-6-astra'];
    return [...new Set([getPlannerModel(), ...list])];
}

export const PLANNER_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type PlannerReasoningEffort = (typeof PLANNER_REASONING_EFFORTS)[number];

export function getPlannerReasoningEffort(): PlannerReasoningEffort {
    const configured = process.env.WORKBENCH_PLANNER_REASONING_EFFORT?.trim();
    return (PLANNER_REASONING_EFFORTS as readonly string[]).includes(configured ?? '')
        ? (configured as PlannerReasoningEffort)
        : 'medium';
}

export function getSearchModel(): string {
    return process.env.WORKBENCH_SEARCH_MODEL?.trim() || 'gpt-6.1-sol';
}

export function getReviewModel(): string {
    return process.env.WORKBENCH_REVIEW_MODEL?.trim() || 'gpt-6.1-sol';
}

export function getAnalysisModel(): string {
    return process.env.WORKBENCH_ANALYSIS_MODEL?.trim() || getReviewModel();
}

export function getDefaultImageModel(): string {
    return process.env.WORKBENCH_IMAGE_MODEL?.trim() || 'gpt-image-2.6-sunburst';
}

export function getWorkerToken(): string | null {
    const fromEnv = process.env.WORKBENCH_WORKER_TOKEN?.trim();
    if (fromEnv) return fromEnv;
    try {
        const token = fs.readFileSync(getWorkerTokenPath(), 'utf8').trim();
        return token || null;
    } catch {
        return null;
    }
}

export function ensureWorkerToken(): string {
    const existing = getWorkerToken();
    if (existing) return existing;
    const token = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(getWorkbenchDataDir(), { recursive: true });
    fs.writeFileSync(getWorkerTokenPath(), `${token}\n`, { encoding: 'utf8', mode: 0o600 });
    return token;
}

export function getLimits() {
    return {
        maxBatchImages: 2,
        maxReferenceImages: 8,
        maxSearchQueries: 4,
        maxSearchResultsPerQuery: 6,
        maxUploadBytes: 25 * 1024 * 1024
    };
}

export function isLoopbackTestDownloadAllowed(): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    if (!isWorkbenchFixtureTest()) return false;
    return process.env.WORKBENCH_TEST_ALLOW_LOOPBACK === '1';
}

export function getStaleSendingMs(): number {
    const minutes = Number(process.env.WORKBENCH_STALE_SENDING_MINUTES || '20');
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : 20) * 60_000;
}
