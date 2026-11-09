export type ReferencePurpose = 'character' | 'face' | 'style' | 'composition' | 'space' | 'pose';

export const REFERENCE_PURPOSES: readonly ReferencePurpose[] = [
    'character',
    'face',
    'style',
    'composition',
    'space',
    'pose'
];

export const REFERENCE_PURPOSE_LABELS: Record<ReferencePurpose, string> = {
    character: '人物外观/服装',
    face: '脸部细节',
    style: '风格',
    composition: '构图',
    space: '空间/材质',
    pose: '姿势'
};

export type DesignCard = {
    subject: string;
    subjectVersion: string;
    sceneIntent: string;
    composition: string;
    actionView: string;
    colorLight: string;
    artStyle: string;
    aspectRatio: string;
    mustKeep: string[];
    mayChange: string[];
    missingReferences: string[];
    assumptions: DesignAssumption[];
};

export type DesignAssumption = {
    field: string;
    value: string;
    reason: string;
};

export type DesignFieldKey = keyof Omit<DesignCard, 'assumptions' | 'missingReferences'>;

export const DESIGN_FIELD_KEYS: readonly DesignFieldKey[] = [
    'subject',
    'subjectVersion',
    'sceneIntent',
    'composition',
    'actionView',
    'colorLight',
    'artStyle',
    'aspectRatio',
    'mustKeep',
    'mayChange'
];

export const DESIGN_FIELD_LABELS: Record<DesignFieldKey, string> = {
    subject: '主体',
    subjectVersion: '角色版本',
    sceneIntent: '场景意图',
    composition: '构图与人物占比',
    actionView: '动作/视角',
    colorLight: '色彩光线',
    artStyle: '绘画语言',
    aspectRatio: '尺寸比例',
    mustKeep: '必须保留',
    mayChange: '允许变化'
};

export type DesignChange = {
    field: DesignFieldKey;
    before: string;
    after: string;
};

export type DesignConflict = {
    field: DesignFieldKey;
    locked: boolean;
    proposed: string;
    reason: string;
};

export type DesignUpdateResult = {
    card: DesignCard;
    changeSummary: DesignChange[];
    conflicts: DesignConflict[];
    requiresUnlock: DesignFieldKey[];
};

export type AssetAnalysis = {
    observable: string[];
    inferences: string[];
    uncertainties: string[];
    styleLanguage: string;
    suggestedPurpose: ReferencePurpose;
    notes: string;
    model: string;
    analyzedAt: string;
    cacheKey: string;
};

export type AssetMeta = {
    id: string;
    sha256: string;
    filename: string;
    originalName: string;
    mime: string;
    width: number;
    height: number;
    bytes: number;
    kind: 'upload' | 'search' | 'generated' | 'reused' | 'mock';
    sourcePage: string | null;
    sourceUrl: string | null;
    acquiredAt: string;
    projectId: string | null;
    mock: boolean;
    analysis: AssetAnalysis | null;
};

export type ReferenceBinding = {
    id: string;
    projectId: string;
    assetId: string;
    purpose: ReferencePurpose;
    borrow: string;
    exclude: string;
    position: number;
    asset: AssetMeta;
};

export type SearchCandidate = {
    id: string;
    projectId: string;
    query: string;
    queryKind: SearchQueryKind;
    title: string;
    imageUrl: string;
    thumbnailUrl: string | null;
    pageUrl: string;
    domain: string;
    trustNote: string;
    licenseNote: string;
    suggestedPurpose: ReferencePurpose;
    width: number | null;
    height: number | null;
    status: 'candidate' | 'imported' | 'failed';
    assetId: string | null;
    error: string | null;
    mock: boolean;
    createdAt: string;
};

export type SearchQueryKind = 'official' | 'pose' | 'space' | 'style';

export type PromptState = {
    text: string;
    avoid: string;
    acceptance: string;
    source: 'compiled' | 'manual';
    designVersion: number;
    bindingHash: string;
    stale: boolean;
    updatedAt: string;
};

export type CostEstimate = {
    kind: 'image_batch';
    imageCalls: number;
    reviewCalls: number;
    totalCalls: number;
    estimatedImageUsd: number | null;
    reviewCostNote: string;
    assumptions: string[];
    priceTableVersion: string;
    priceTableSource: string;
    uncertainty: 'low' | 'medium' | 'high' | 'unknown';
};

export type Authorization = {
    approvedByUser: boolean;
    approvedAt: string;
    maxCalls: number;
    maxImageOutputs: number;
    budgetUsd: number;
    riskAcknowledged: boolean;
};

export type SnapshotReference = {
    assetId: string;
    sha256: string;
    filename: string;
    mime: string;
    purpose: ReferencePurpose;
    borrow: string;
    exclude: string;
    position: number;
};

export type RunSnapshot = {
    designCard: DesignCard;
    lockedFields: DesignFieldKey[];
    prompt: string;
    avoid: string;
    acceptance: string;
    references: SnapshotReference[];
    params: {
        model: string;
        size: string;
        quality: string;
        background: string;
        outputFormat: string;
        moderation: string;
        imageCount: 1 | 2;
        complexity?: string;
    };
    review: {
        enabled: boolean;
        model: string;
    };
    operation: {
        action: RunAction;
        sourceRunId?: string;
        baseVersionId?: string;
        changePoints?: string[];
        keepPoints?: string[];
        instruction?: string;
    };
    estimate: CostEstimate;
    authorization: Authorization;
    plannerModel: string | null;
    mock: boolean;
};

export type RunAction = 'generate' | 'revise' | 'reroll';

export type RunStatus =
    | 'queued'
    | 'running'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'stopped'
    | 'paused_unknown'
    | 'paused_budget';

export type RunItemKind = 'image' | 'review';

export type RunItemStatus = 'pending' | 'sending' | 'success' | 'failed' | 'unknown' | 'skipped' | 'review_unavailable';

export type ReviewIssueType = 'visible_deviation' | 'uncertainty' | 'aesthetic';

export type ReviewIssue = {
    type: ReviewIssueType;
    aspect: string;
    problem: string;
    evidence: string;
    confidence: 'high' | 'medium' | 'low';
    keep: string;
    change: string;
};

export type ReviewComparison = {
    recommendedVersionId: string;
    recommendedLabel: string;
    reason: string;
};

export type ReviewResult = {
    acceptable: boolean;
    summary: string;
    compliant: { aspect: string; note: string }[];
    issues: ReviewIssue[];
    comparison: ReviewComparison | null;
    model: string;
    reviewedAt: string;
    mock: boolean;
};

export type VersionRecord = {
    id: string;
    projectId: string;
    runId: string;
    assetId: string;
    parentVersionId: string | null;
    label: string;
    isBaseline: boolean;
    review: ReviewResult | null;
    reviewStatus: 'pending' | 'available' | 'unavailable';
    createdAt: string;
    mock: boolean;
    asset: AssetMeta;
    runAction: RunAction;
};

export type RunItemRecord = {
    id: string;
    runId: string;
    position: number;
    kind: RunItemKind;
    status: RunItemStatus;
    targetVersionId: string | null;
    outputAssetId: string | null;
    versionId: string | null;
    requestId: string | null;
    openaiRequestId: string | null;
    usage: Record<string, unknown> | null;
    estimatedCostUsd: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
};

export type RunSummary = {
    id: string;
    projectId: string;
    action: RunAction;
    status: RunStatus;
    stopRequested: boolean;
    snapshot: RunSnapshot;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
    mock: boolean;
    items: RunItemRecord[];
};

export type ProjectSummary = {
    id: string;
    name: string;
    entry: 'keyword' | 'upload';
    mock: boolean;
    designVersion: number;
    baselineVersionId: string | null;
    createdAt: string;
    updatedAt: string;
    latestRunStatus: RunStatus | null;
    runCount: number;
    versionCount: number;
};

export type ProjectDetail = {
    project: ProjectSummary;
    design: DesignCard;
    lockedFields: DesignFieldKey[];
    prompt: PromptState;
    references: ReferenceBinding[];
    assets: AssetMeta[];
    candidates: SearchCandidate[];
    runs: RunSummary[];
    versions: VersionRecord[];
    status: WorkbenchStatus;
};

export type WorkbenchStatus = {
    imageApiEnabled: boolean;
    apiKeyConfigured: boolean;
    plannerModel: string;
    plannerModels: string[];
    plannerReasoningEffort: string;
    plannerReasoningEfforts: string[];
    searchModel: string;
    reviewModel: string;
    analysisModel: string;
    defaultImageModel: string;
    models: {
        image: string[];
        quality: string[];
    };
    limits: {
        maxBatchImages: number;
        maxReferenceImages: number;
        maxSearchQueries: number;
        maxSearchResultsPerQuery: number;
        maxUploadBytes: number;
    };
    priceTable: {
        version: string;
        source: string;
        updatedAt: string;
    };
    worker: {
        tokenConfigured: boolean;
        lastTickAt: string | null;
    };
};

export type ProjectListResponse = {
    projects: ProjectSummary[];
    status: WorkbenchStatus;
};

export type ActionError = {
    error: string;
    code: string;
    details?: unknown;
};

export type CreateRunInput = {
    action: RunAction;
    imageCount: 1 | 2;
    model: string;
    size: string;
    quality: string;
    background: 'auto' | 'opaque' | 'transparent';
    outputFormat: 'png' | 'jpeg' | 'webp';
    moderation: 'auto' | 'low';
    budgetUsd: number;
    riskAcknowledged: boolean;
    baseVersionId?: string;
    changePoints?: string[];
    keepPoints?: string[];
    sourceRunId?: string;
};

export const WORKBENCH_ROUTE = '/workbench';
