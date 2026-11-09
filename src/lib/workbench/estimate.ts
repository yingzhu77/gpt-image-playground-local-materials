import { getModelRates, tokensToUsd } from '@/lib/cost-utils';
import { isGptImageModel } from '@/lib/models';
import { isWorkbenchFixtureTest, PRICE_TABLE_SOURCE, PRICE_TABLE_VERSION } from '@/lib/workbench/config';
import type { CostEstimate } from '@/lib/workbench/types';

const OUTPUT_TOKENS_BY_QUALITY: Record<string, number> = {
    auto: 1056,
    low: 272,
    medium: 1056,
    high: 4160,
    xhigh: 6144,
    max: 8192
};

const BASE_PIXELS = 1024 * 1024;

export function estimateImageTokens(input: { size: string; quality: string; promptChars: number; referencePixels: number[] }) {
    const pixels = parseSizePixels(input.size) ?? BASE_PIXELS;
    const scale = pixels / BASE_PIXELS;
    const outputTokens = Math.round((OUTPUT_TOKENS_BY_QUALITY[input.quality] ?? 1056) * scale);
    const textInputTokens = Math.ceil(input.promptChars / 1.6);
    const imageInputTokens = input.referencePixels.reduce((sum, item) => sum + Math.ceil((item / 1_000_000) * 1500), 0);
    return { outputTokens, textInputTokens, imageInputTokens };
}

export function buildCostEstimate(input: {
    model: string;
    size: string;
    quality: string;
    imageCount: 1 | 2;
    promptChars: number;
    referencePixels: number[];
    mock: boolean;
}): CostEstimate {
    const assumptions = [
        '按项目内价格表的 token 费率估算，不是供应商账单。',
        '输出 token 按质量档位与像素数线性估算；实际用量以上游 usage 为准。',
        '参考图输入 token 按每百万像素约 1500 token 粗估。',
        '审稿调用使用文本模型，当前未配置文本模型价格表，费用未知。'
    ];

    if (input.mock && !isWorkbenchFixtureTest()) throw new Error('历史测试快照不能按真实请求估价或执行。');
    if (isWorkbenchFixtureTest()) {
        return {
            kind: 'image_batch',
            imageCalls: input.imageCount,
            reviewCalls: input.imageCount,
            totalCalls: input.imageCount * 2,
            estimatedImageUsd: 0,
            reviewCostNote: '隔离自动化测试使用本地夹具，不产生真实费用。',
            assumptions: ['测试提供方不会调用真实 API，费用为 0 仅表示没有真实请求。'],
            priceTableVersion: PRICE_TABLE_VERSION,
            priceTableSource: PRICE_TABLE_SOURCE,
            uncertainty: 'low'
        };
    }

    if (!isGptImageModel(input.model)) {
        return {
            kind: 'image_batch',
            imageCalls: input.imageCount,
            reviewCalls: input.imageCount,
            totalCalls: input.imageCount * 2,
            estimatedImageUsd: null,
            reviewCostNote: '模型不在本地价格表中，图片生成费用无法估计。',
            assumptions: [...assumptions, '模型未收录于本地价格表。'],
            priceTableVersion: PRICE_TABLE_VERSION,
            priceTableSource: PRICE_TABLE_SOURCE,
            uncertainty: 'unknown'
        };
    }

    const tokens = estimateImageTokens(input);
    const rates = getModelRates(input.model);
    const perImage =
        tokensToUsd(tokens.textInputTokens, rates.textInputPerMillion) +
        tokensToUsd(tokens.imageInputTokens, rates.imageInputPerMillion) +
        tokensToUsd(tokens.outputTokens, rates.imageOutputPerMillion);
    const total = Math.round(perImage * input.imageCount * 10000) / 10000;

    return {
        kind: 'image_batch',
        imageCalls: input.imageCount,
        reviewCalls: input.imageCount,
        totalCalls: input.imageCount * 2,
        estimatedImageUsd: total,
        reviewCostNote: '审稿费用未知（文本模型价格未配置），需明确风险授权。',
        assumptions,
        priceTableVersion: PRICE_TABLE_VERSION,
        priceTableSource: PRICE_TABLE_SOURCE,
        uncertainty: 'high'
    };
}

export function parseSizePixels(size: string): number | null {
    const match = /^(\d+)x(\d+)$/.exec(size);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width > 0 && height > 0 ? width * height : null;
}
