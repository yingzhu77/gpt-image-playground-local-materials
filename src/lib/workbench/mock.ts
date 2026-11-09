import { getCandidateDir, getPlannerModel, getReviewModel } from '@/lib/workbench/config';
import { computeDesignDiff, mergeDesignProposal, parseAnalysis } from '@/lib/workbench/schema';
import type {
    AssetAnalysis,
    AssetMeta,
    DesignCard,
    DesignUpdateResult,
    ReferencePurpose,
    ReviewResult,
    SearchCandidate,
    SearchQueryKind
} from '@/lib/workbench/types';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

type MockScenario = {
    plannerError?: boolean;
    analysisError?: boolean;
    reviewError?: boolean;
    reviewIssues?: 'none' | 'one';
    searchError?: boolean;
    searchEmpty?: boolean;
    searchResults?: number;
};

export async function readMockScenario(): Promise<MockScenario> {
    const file = process.env.WORKBENCH_MOCK_SCENARIO_FILE?.trim();
    if (!file) return {};
    try {
        const content = await fs.readFile(path.resolve(/*turbopackIgnore: true*/ process.cwd(), file), 'utf8');
        return JSON.parse(content) as MockScenario;
    } catch {
        return {};
    }
}

export class MockWorkbenchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MockWorkbenchError';
    }
}

function caseACard(): DesignCard {
    return {
        subject: '阿米娅（Arknights）',
        subjectVersion: '以用户选定官图为准；未收到官图前按默认常服形态作为明确假设',
        sceneIntent:
            '一片安静的舞台街景布景：左侧是完成的建筑正面，右侧是同一空间的布景背面与木支架，两者关系可信，不出现两个割裂场景。',
        composition:
            '16:9 横构图，人物位于中景，约占画面高度 45%–55%；左侧建筑正面、右侧木支架，耳朵与鞋子完整入画，人物不被前景遮挡。',
        actionView: '侧背面自然行走，重心自然、步态克制；不照抄官图立绘站姿。',
        colorLight: '柔和低对比自然光，中性暖灰为主，避免舞台演出灯光与强烈轮廓光。',
        artStyle: '主流动画插画质感，干净边缘与克制的细节取舍；建筑与木支架保持结构可信。',
        aspectRatio: '16:9',
        mustKeep: ['阿米娅角色特征与耳朵轮廓', '服装结构与选定官图一致', '左侧正面/右侧背面的空间关系', '耳朵和鞋子完整入画'],
        mayChange: ['具体行走步态', '木支架纹理与背景杂物', '光影微调与色彩冷暖'],
        missingReferences: ['阿米娅官图（外观与服装）', '舞台街景背板与木支架空间参考', '自然行走侧背面姿态参考'],
        assumptions: [
            {
                field: 'subjectVersion',
                value: '默认常服/近卫形态',
                reason: '尚未上传官图，先给出可编辑的单一方向，收到官图后应校正版本。'
            },
            {
                field: 'composition',
                value: '人物高度约画面一半',
                reason: '“中景清楚可辨”的合理取值，可在设计卡中直接修改。'
            }
        ]
    };
}

function caseBCard(input: string): DesignCard {
    return {
        subject: '阿米娅（Arknights）',
        subjectVersion: '以单独绑定的角色官图为准，不从风格参考图借用人物或服装',
        sceneIntent: `安静日常画面（来自输入：${input.slice(0, 120)}）。风格参考只影响色彩、光线、边缘、线条与细节取舍。`,
        composition: '16:9 横构图，中景，人物与环境留出呼吸空间，避免复述风格参考图的原构图。',
        actionView: '安静停留或轻微日常动作，视角自然，不照抄风格参考图的人物姿态。',
        colorLight: '沿用风格参考图的色彩倾向、光线组织与明暗层次，但重新组织具体场景光源。',
        artStyle: '沿用风格参考图的绘画语言：边缘处理、线条密度、细节取舍与笔触质感；不复用其人物与场景内容。',
        aspectRatio: '16:9',
        mustKeep: ['阿米娅角色特征与服装以角色官图为准', '只借风格，不复述参考图人物与场景'],
        mayChange: ['具体日常场景物件', '人物姿态与镜头角度', '光线方向'],
        missingReferences: ['阿米娅角色官图（外观/服装）'],
        assumptions: [
            {
                field: 'sceneIntent',
                value: '安静日常',
                reason: '输入只给出风格与氛围，具体日常场景属于可编辑假设。'
            }
        ]
    };
}

export async function mockCreateDesignDraft(input: {
    text: string;
    entry: 'keyword' | 'upload';
    hasUpload: boolean;
}): Promise<{ name: string; card: DesignCard }> {
    const scenario = await readMockScenario();
    if (scenario.plannerError) throw new MockWorkbenchError('模拟规划失败：未发送真实请求。');

    const isStage = /舞台|布景|阿米娅.*(走|街景)|侧背面/.test(input.text);
    const card = isStage ? caseACard() : caseBCard(input.text);
    if (input.hasUpload) {
        card.missingReferences = card.missingReferences.filter((item) => !item.includes('上传'));
    }
    const name = input.text.trim().slice(0, 24) || (isStage ? '阿米娅舞台布景' : '新创作项目');
    return { name, card };
}

type ScalarDesignField =
    | 'subject'
    | 'subjectVersion'
    | 'sceneIntent'
    | 'composition'
    | 'actionView'
    | 'colorLight'
    | 'artStyle'
    | 'aspectRatio';

const FIELD_KEYWORDS: { field: ScalarDesignField; pattern: RegExp }[] = [
    { field: 'composition', pattern: /构图|位置|大小|大一点|小一点|占比|取景/ },
    { field: 'subject', pattern: /服装|角色|外观|衣服|服饰/ },
    { field: 'sceneIntent', pattern: /场景|背景|空间|舞台|街景/ },
    { field: 'colorLight', pattern: /颜色|色彩|光线|色调|明暗/ },
    { field: 'artStyle', pattern: /风格|画风|笔触|线条/ },
    { field: 'actionView', pattern: /动作|姿势|姿态|视角|行走/ },
    { field: 'aspectRatio', pattern: /比例|尺寸|横构图|竖构图|16:9|9:16/ }
];

export async function mockUpdateDesign(input: {
    instruction: string;
    current: DesignCard;
    lockedFields: Parameters<typeof mergeDesignProposal>[0]['lockedFields'];
}): Promise<DesignUpdateResult> {
    const scenario = await readMockScenario();
    if (scenario.plannerError) throw new MockWorkbenchError('模拟规划失败：未发送真实请求。');

    const proposed: DesignCard = JSON.parse(JSON.stringify(input.current)) as DesignCard;
    const matches = FIELD_KEYWORDS.filter((entry) => entry.pattern.test(input.instruction));
    const target = matches[0]?.field ?? 'sceneIntent';

    if (target === 'composition') {
        const bigger = /大|近|占比/.test(input.instruction);
        proposed.composition = bigger
            ? '保持原有空间关系，人物在中景基础上稍微放大，约占画面高度 55%–60%，耳朵和鞋子仍完整入画。'
            : '保持原有空间关系，人物占比略微调整，耳朵和鞋子仍完整入画。';
    } else if (target === 'subject') {
        proposed.subject = '阿米娅（Arknights），服装按修改要求调整，其余角色特征保留';
        proposed.subjectVersion = `${input.current.subjectVersion}；服装变化需以官图或明确新设定为准`;
    } else if (target === 'sceneIntent') {
        proposed.sceneIntent = `${input.current.sceneIntent} 调整：${input.instruction}`;
    } else if (target === 'colorLight') {
        proposed.colorLight = `${input.current.colorLight} 调整：${input.instruction}`;
    } else if (target === 'artStyle') {
        proposed.artStyle = `${input.current.artStyle} 调整：${input.instruction}`;
    } else if (target === 'actionView') {
        proposed.actionView = `${input.current.actionView} 调整：${input.instruction}`;
    } else if (target === 'aspectRatio') {
        proposed.aspectRatio = /9:16|竖/.test(input.instruction) ? '9:16' : input.current.aspectRatio;
    }

    proposed.assumptions = [
        ...input.current.assumptions,
        {
            field: target,
            value: proposed[target] as string,
            reason: `按你的自然语言修改“${input.instruction.slice(0, 60)}”做了最小范围调整。`
        }
    ].slice(0, 8);

    return mergeDesignProposal({ current: input.current, proposed, lockedFields: input.lockedFields });
}

export async function mockAnalyzeAsset(asset: AssetMeta): Promise<AssetAnalysis> {
    const scenario = await readMockScenario();
    if (scenario.analysisError) throw new MockWorkbenchError('模拟视觉分析失败：未发送真实请求。');

    const name = `${asset.originalName} ${asset.filename}`.toLowerCase();
    let purpose: ReferencePurpose = 'style';
    if (/官图|character|chara|阿米娅|amiya/.test(name)) purpose = 'character';
    if (/pose|姿势|行走|walk/.test(name)) purpose = 'pose';
    if (/stage|backdrop|布景|舞台|space/.test(name)) purpose = 'space';
    if (/face|脸/.test(name)) purpose = 'face';
    if (/composition|构图/.test(name)) purpose = 'composition';

    const analysis: AssetAnalysis = {
        observable: [
            `实际读取文件：${asset.width}x${asset.height}，${asset.mime}，${asset.bytes} 字节`,
            '画面存在可辨识的主体轮廓与明暗分区（模拟分析文本，未调用视觉模型）',
            '边缘、色块与细节密度可区分为观察特征'
        ],
        inferences: [
            '根据文件名推测用途，属于推测而非视觉确认',
            '来源与授权状态需另行核验'
        ],
        uncertainties: ['模拟模式下无法确认真实人物身份、服装细节与来源授权'],
        styleLanguage:
            '模拟风格描述：中等对比、克制的饱和度、干净边缘与选择性细节；仅作为流程演示，不代表真实看图结论。',
        suggestedPurpose: purpose,
        notes: '这是 Mock 分析结果，不会调用真实视觉模型；请在真实模式重新分析后再用于生图判断。',
        model: 'mock-analysis',
        analyzedAt: new Date().toISOString(),
        cacheKey: ''
    };
    return parseAnalysis(analysis);
}

export async function mockReview(input: {
    label: string;
    secondLabel?: string;
    design: DesignCard;
}): Promise<ReviewResult> {
    const scenario = await readMockScenario();
    if (scenario.reviewError) throw new MockWorkbenchError('模拟审稿失败：未发送真实请求。');

    const issues =
        scenario.reviewIssues === 'none'
            ? []
            : [
                  {
                      type: 'aesthetic' as const,
                      aspect: '画面细节',
                      problem: '模拟审稿：背景木支架的细节略抢主体，可再克制一点。',
                      evidence: '模拟证据：中景主体与右侧支架的细节密度接近（非真实看图）。',
                      confidence: 'low' as const,
                      keep: '人物尺度与左右空间关系',
                      change: '略降低背景木支架的细节对比'
                  }
              ];

    const comparison =
        input.secondLabel !== undefined
            ? {
                  recommendedVersionId: '',
                  recommendedLabel: input.secondLabel,
                  reason: '模拟比较：第二张在人物占比与空间完整性上更接近本次目标；仅作流程演示。'
              }
            : null;

    return {
        acceptable: true,
        summary: '模拟审稿：本轮整体目标可接受，未发现必须重做的可见偏差（Mock 数据）。',
        compliant: [
            { aspect: '角色/服装', note: '按本次快照中的锁定项检查（模拟，未真实看图）。' },
            { aspect: '空间关系', note: '左右结构与中景人物尺度按设计卡检查（模拟）。' }
        ],
        issues,
        comparison,
        model: 'mock-review',
        reviewedAt: new Date().toISOString(),
        mock: true
    };
}

const MOCK_COLORS = ['#5b6c8f', '#8f6b5b', '#5b8f76', '#8f5b7d', '#6b5b8f', '#8f825b'];

export async function mockSearchCandidates(input: {
    projectId: string;
    query: string;
    queryKind: SearchQueryKind;
    suggestedPurpose: ReferencePurpose;
    count: number;
}): Promise<Omit<SearchCandidate, 'id' | 'createdAt' | 'status' | 'assetId' | 'error'>[]> {
    const scenario = await readMockScenario();
    if (scenario.searchError) throw new MockWorkbenchError('模拟联网搜图失败：未发送真实请求。');
    if (scenario.searchEmpty) return [];

    const dir = getCandidateDir();
    await fs.mkdir(dir, { recursive: true });
    const count = Math.max(1, Math.min(scenario.searchResults ?? input.count, 6));
    const hash = crypto.createHash('sha1').update(input.query).digest('hex').slice(0, 8);
    const results: Omit<SearchCandidate, 'id' | 'createdAt' | 'status' | 'assetId' | 'error'>[] = [];

    for (let index = 0; index < count; index++) {
        const filename = `mock-${input.queryKind}-${hash}-${index}.png`;
        const filepath = path.join(dir, filename);
        try {
            await fs.access(filepath);
        } catch {
            const color = MOCK_COLORS[index % MOCK_COLORS.length];
            const svg = `<svg width="960" height="540" xmlns="http://www.w3.org/2000/svg">
                <rect width="960" height="540" fill="${color}"/>
                <rect x="48" y="48" width="864" height="444" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
                <text x="80" y="120" fill="#ffffff" font-size="34" font-family="sans-serif">MOCK candidate ${index + 1}</text>
                <text x="80" y="170" fill="#ffffff" font-size="22" font-family="sans-serif">${input.queryKind} · not a real web result</text>
            </svg>`;
            await sharp(Buffer.from(svg)).png().toFile(filepath);
        }
        results.push({
            projectId: input.projectId,
            query: input.query,
            queryKind: input.queryKind,
            title: `模拟候选 ${index + 1}：${input.query.slice(0, 40)}`,
            imageUrl: `/api/workbench/mock-candidate/${filename}`,
            thumbnailUrl: `/api/workbench/mock-candidate/${filename}`,
            pageUrl: `https://example.com/mock/${input.queryKind}/${hash}/${index}`,
            domain: 'example.com（模拟）',
            trustNote: '模拟候选，未进行真实联网搜索，来源未核验，不代表任何真实来源',
            licenseNote: '模拟数据，授权状态未知；真实模式需逐张核验',
            suggestedPurpose: input.suggestedPurpose,
            width: 960,
            height: 540,
            mock: true
        });
    }
    return results;
}

export function mockModels() {
    return {
        planner: getPlannerModel(),
        review: getReviewModel()
    };
}

export function mockDesignDiff(before: DesignCard, after: DesignCard) {
    return computeDesignDiff(before, after);
}
