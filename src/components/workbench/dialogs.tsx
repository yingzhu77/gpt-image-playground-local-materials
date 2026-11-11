'use client';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge, Spinner, type PaidRequest, type PanelProps } from '@/components/workbench/shared';
import { supportsExtendedQuality, type GptImageModel } from '@/lib/models';
import { validateCustomSize } from '@/lib/size-utils';
import { formatTime, formatUsd, newActionId, projectAction } from '@/lib/workbench/client';
import {
    REFERENCE_PURPOSE_LABELS,
    type CostEstimate,
    type ProjectDetail,
    type RunSummary,
    type VersionRecord,
    type WorkbenchStatus
} from '@/lib/workbench/types';
import * as React from 'react';

export function PaidConfirmDialog({ request, onClose }: { request: PaidRequest | null; onClose: () => void }) {
    const [busy, setBusy] = React.useState(false);
    const [failure, setFailure] = React.useState<{ request: PaidRequest; message: string } | null>(null);
    async function confirm() {
        if (!request) return;
        setBusy(true);
        setFailure(null);
        try {
            await request.onConfirm();
            onClose();
        } catch (error) {
            setFailure({ request, message: error instanceof Error ? error.message : '操作失败，请检查错误信息。' });
        } finally {
            setBusy(false);
        }
    }
    return (
        <Dialog open={!!request} onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
            <DialogContent className='border-wb-border bg-wb-panel text-wb-ink'>
                <DialogHeader>
                    <DialogTitle>{request?.title ?? ''}</DialogTitle>
                    <DialogDescription>{request?.description ?? ''}</DialogDescription>
                </DialogHeader>
                <ul className='border-wb-border bg-wb-subtle text-wb-ink space-y-1 rounded border p-2 text-xs'>
                    {request?.lines.map((line, index) => (
                        <li key={index}>• {line}</li>
                    ))}
                </ul>
                {failure?.request === request && (
                    <p role='alert' className='text-wb-error text-sm leading-relaxed'>
                        {failure.message}
                    </p>
                )}
                <DialogFooter>
                    <Button variant='outline' disabled={busy} onClick={onClose}>
                        取消
                    </Button>
                    <Button disabled={busy} onClick={() => void confirm()}>
                        {busy ? <Spinner label='执行中' /> : (request?.confirmLabel ?? '确认')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function PlannerSettingsDialog({
    status,
    model,
    effort,
    onClose,
    onSave
}: {
    status: WorkbenchStatus;
    model: string;
    effort: string;
    onClose: () => void;
    onSave: (model: string, effort: string) => void;
}) {
    const [nextModel, setNextModel] = React.useState(model);
    const [nextEffort, setNextEffort] = React.useState(effort);
    return (
        <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
            <DialogContent className='border-wb-border bg-wb-panel text-wb-ink'>
                <DialogHeader>
                    <DialogTitle>规划设置</DialogTitle>
                    <DialogDescription>仅影响设计卡规划与自然语言修改；不会生图、不会搜索。</DialogDescription>
                </DialogHeader>
                <div className='space-y-3'>
                    <div className='space-y-1'>
                        <p className='text-wb-muted text-xs'>规划模型</p>
                        <Select value={nextModel} onValueChange={setNextModel}>
                            <SelectTrigger aria-label='规划模型' className='border-wb-border bg-wb-panel h-9 text-sm'>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {status.plannerModels.map((item) => (
                                    <SelectItem key={item} value={item}>
                                        {item}
                                        {item === status.plannerModel ? '（服务端默认）' : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className='text-wb-muted text-xs'>
                            允许列表由 WORKBENCH_PLANNER_MODELS 控制；服务端会拒绝列表外模型。
                        </p>
                    </div>
                    <div className='space-y-1'>
                        <p className='text-wb-muted text-xs'>思考强度（reasoning.effort）</p>
                        <Select value={nextEffort} onValueChange={setNextEffort}>
                            <SelectTrigger aria-label='思考强度' className='border-wb-border bg-wb-panel h-9 text-sm'>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {status.plannerReasoningEfforts.map((item) => (
                                    <SelectItem key={item} value={item}>
                                        {item}
                                        {item === status.plannerReasoningEffort ? '（默认）' : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className='text-wb-muted text-xs'>
                            gpt-6.1-sol 支持 low / medium / high / xhigh / max，默认 medium，不支持 none。非 reasoning
                            模型可能拒绝该参数。
                        </p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant='outline' onClick={onClose}>
                        取消
                    </Button>
                    <Button
                        onClick={() => {
                            onSave(nextModel, nextEffort);
                            onClose();
                        }}>
                        保存规划设置
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const SIZE_OPTIONS = [
    { value: '2048x1152', label: '16:9 · 2048×1152' },
    { value: '1536x864', label: '16:9 · 1536×864（草稿）' },
    { value: '1024x1024', label: '1:1 · 1024×1024' },
    { value: '2048x2048', label: '1:1 · 2048×2048' },
    { value: 'auto', label: 'auto（由模型决定）' },
    { value: 'custom', label: '自定义 W×H' }
];

type RunParams = {
    model: string;
    size: string;
    quality: string;
    imageCount: 1 | 2;
    background: 'auto' | 'opaque' | 'transparent';
    outputFormat: 'png' | 'jpeg' | 'webp';
    moderation: 'auto' | 'low';
};

function defaultParams(status: WorkbenchStatus): RunParams {
    return {
        model: status.defaultImageModel,
        size: '2048x1152',
        quality: 'high',
        imageCount: 1,
        background: 'auto',
        outputFormat: 'png',
        moderation: 'auto'
    };
}

function resolveSize(size: string, width: number, height: number): string {
    return size === 'custom' ? `${width}x${height}` : size;
}

export function GenerateDialog({
    onClose,
    detail,
    status,
    onAction,
    notify,
    setError
}: {
    onClose: () => void;
    detail: ProjectDetail;
    status: WorkbenchStatus;
    onAction: PanelProps['onAction'];
    notify: (message: string) => void;
    setError: (message: string | null) => void;
}) {
    const [params, setParams] = React.useState<RunParams>(() => defaultParams(status));
    const [width, setWidth] = React.useState(2048);
    const [height, setHeight] = React.useState(1152);
    const [budgetUsd, setBudgetUsd] = React.useState(1);
    const [risk, setRisk] = React.useState(false);
    const [preview, setPreview] = React.useState<{
        estimate: CostEstimate;
        budgetMinUsd: number | null;
        promptStale: boolean;
        referenceCount: number;
    } | null>(null);
    const [previewError, setPreviewError] = React.useState<string | null>(null);
    const [previewKey, setPreviewKey] = React.useState('');
    const [submitError, setSubmitError] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [actionId] = React.useState(() => newActionId());

    const resolvedSize = resolveSize(params.size, width, height);
    const customValidation = params.size === 'custom' ? validateCustomSize(width, height) : { valid: true as const };
    const estimateKey = JSON.stringify([detail.project.id, params, resolvedSize, budgetUsd]);
    const currentPreview = previewKey === estimateKey ? preview : null;

    React.useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            if (params.size === 'custom' && !customValidation.valid) return;
            void projectAction<{
                preview: {
                    estimate: CostEstimate;
                    budgetMinUsd: number | null;
                    promptStale: boolean;
                    referenceCount: number;
                };
            }>(detail.project.id, {
                action: 'run.estimate',
                run: {
                    action: 'generate',
                    ...params,
                    size: resolvedSize,
                    budgetUsd,
                    riskAcknowledged: true
                }
            })
                .then((response) => {
                    if (!cancelled) {
                        setPreview(response.preview);
                        setPreviewKey(estimateKey);
                        setPreviewError(null);
                    }
                })
                .catch((error: unknown) => {
                    if (!cancelled) setPreviewError(error instanceof Error ? error.message : '估价失败。');
                });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [detail.project.id, params, resolvedSize, width, height, budgetUsd, customValidation.valid, estimateKey]);

    async function submit() {
        setBusy(true);
        setSubmitError(null);
        setError(null);
        try {
            const response = await onAction('run.create', {
                actionId,
                run: {
                    action: 'generate',
                    ...params,
                    size: resolvedSize,
                    budgetUsd,
                    riskAcknowledged: risk
                }
            });
            const reused = response?.reused === true;
            notify(
                reused
                    ? '相同动作已存在，已返回同一任务（未重复提交）。'
                    : '已创建生成任务；可关闭页面，worker 会继续执行。'
            );
            onClose();
        } catch (error) {
            const message = error instanceof Error ? error.message : '创建任务失败。';
            setSubmitError(message);
            setError(message);
        } finally {
            setBusy(false);
        }
    }

    const qualityOptions = status.models.quality.filter(
        (quality) =>
            supportsExtendedQuality(params.model as GptImageModel) || (quality !== 'xhigh' && quality !== 'max')
    );
    const canSubmit =
        !busy &&
        !!currentPreview &&
        !detail.prompt.stale &&
        detail.prompt.text.trim().length > 0 &&
        (params.size !== 'custom' || customValidation.valid) &&
        budgetUsd > 0 &&
        risk;

    return (
        <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
            <DialogContent className='border-wb-border bg-wb-panel text-wb-ink max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
                <DialogHeader>
                    <DialogTitle>生成图片</DialogTitle>
                    <DialogDescription>确认后按当前保存的方案生成。</DialogDescription>
                </DialogHeader>
                {submitError && (
                    <p role='alert' className='text-wb-error text-sm leading-relaxed'>
                        {submitError}
                    </p>
                )}

                <div className='border-wb-border bg-wb-accent-soft text-wb-ink space-y-2 rounded-md border p-3 text-sm'>
                    <p className='font-medium'>将发送已保存的设计 v{detail.project.designVersion}</p>
                    <p className='text-wb-muted text-xs'>
                        提示词{detail.prompt.source === 'manual' ? '手动版' : '编译版'} · 保存于{' '}
                        {formatTime(detail.prompt.updatedAt)}
                    </p>
                    <details>
                        <summary className='text-wb-accent cursor-pointer text-xs'>展开完整已保存内容</summary>
                        <div className='mt-3 space-y-3'>
                            <div>
                                <p className='text-wb-muted mb-1 text-xs font-medium'>主提示词</p>
                                <pre className='bg-wb-panel max-h-64 overflow-auto rounded-md p-3 font-sans text-sm leading-relaxed break-words whitespace-pre-wrap'>
                                    {detail.prompt.text || '尚未保存提示词'}
                                </pre>
                            </div>
                            <div>
                                <p className='text-wb-muted mb-1 text-xs font-medium'>避免项</p>
                                <p className='text-sm leading-relaxed whitespace-pre-wrap'>
                                    {detail.prompt.avoid || '未设置'}
                                </p>
                            </div>
                            <div>
                                <p className='text-wb-muted mb-1 text-xs font-medium'>验收项</p>
                                <p className='text-sm leading-relaxed whitespace-pre-wrap'>
                                    {detail.prompt.acceptance || '未设置'}
                                </p>
                            </div>
                        </div>
                    </details>
                </div>

                {detail.prompt.stale && (
                    <div className='border-wb-error bg-wb-subtle text-wb-error rounded border p-2 text-xs'>
                        提示词已过期。请先在提示词面板保留手动版或重新编译后再生成。
                    </div>
                )}

                <details className='border-wb-border rounded-md border p-3'>
                    <summary className='text-wb-accent cursor-pointer text-sm'>
                        参数 · {params.model} · {resolvedSize}
                    </summary>
                    <div className='mt-3 grid gap-3 sm:grid-cols-2'>
                        <div className='space-y-1'>
                            <p className='text-wb-muted text-xs'>模型</p>
                            <Select
                                value={params.model}
                                onValueChange={(value) => setParams((current) => ({ ...current, model: value }))}>
                                <SelectTrigger
                                    aria-label='图像模型'
                                    className='border-wb-border bg-wb-panel h-9 text-sm'>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {status.models.image.map((model) => (
                                        <SelectItem key={model} value={model}>
                                            {model}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className='space-y-1'>
                            <p className='text-wb-muted text-xs'>尺寸</p>
                            <Select
                                value={params.size}
                                onValueChange={(value) => setParams((current) => ({ ...current, size: value }))}>
                                <SelectTrigger
                                    aria-label='图像尺寸'
                                    className='border-wb-border bg-wb-panel h-9 text-sm'>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {SIZE_OPTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {params.size === 'custom' && (
                                <div className='flex items-center gap-1'>
                                    <Input
                                        aria-label='自定义宽度'
                                        type='number'
                                        value={width}
                                        onChange={(event) => setWidth(Number(event.target.value))}
                                        className='border-wb-border bg-wb-panel h-9 w-24 text-sm'
                                    />
                                    <span className='text-wb-muted text-xs'>×</span>
                                    <Input
                                        aria-label='自定义高度'
                                        type='number'
                                        value={height}
                                        onChange={(event) => setHeight(Number(event.target.value))}
                                        className='border-wb-border bg-wb-panel h-9 w-24 text-sm'
                                    />
                                </div>
                            )}
                            {params.size === 'custom' && !customValidation.valid && (
                                <p className='text-wb-error text-xs'>{customValidation.reason}</p>
                            )}
                        </div>
                        <div className='space-y-1'>
                            <p className='text-wb-muted text-xs'>质量</p>
                            <Select
                                value={params.quality}
                                onValueChange={(value) => setParams((current) => ({ ...current, quality: value }))}>
                                <SelectTrigger
                                    aria-label='图像质量'
                                    className='border-wb-border bg-wb-panel h-9 text-sm'>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {qualityOptions.map((quality) => (
                                        <SelectItem key={quality} value={quality}>
                                            {quality}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </details>
                <div className='grid gap-3 sm:grid-cols-2'>
                    <div className='space-y-1'>
                        <p className='text-wb-muted text-xs'>生成数量</p>
                        <Select
                            value={String(params.imageCount)}
                            onValueChange={(value) =>
                                setParams((current) => ({ ...current, imageCount: Number(value) === 2 ? 2 : 1 }))
                            }>
                            <SelectTrigger
                                aria-label='生成图片数量'
                                className='border-wb-border bg-wb-panel h-9 text-sm'>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value='1'>1 张（默认）</SelectItem>
                                <SelectItem value='2'>2 张（两张独立请求）</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className='space-y-1'>
                        <p className='text-wb-muted text-xs'>预算上限（美元）</p>
                        <Input
                            aria-label='预算上限（USD）'
                            type='number'
                            min={0.01}
                            step={0.01}
                            value={budgetUsd}
                            onChange={(event) => setBudgetUsd(Number(event.target.value))}
                            className='border-wb-border bg-wb-panel h-9 text-sm'
                        />
                    </div>
                    <div className='space-y-1'>
                        <p className='text-wb-muted text-xs'>参考图</p>
                        <p className='border-wb-border bg-wb-subtle text-wb-ink rounded border px-2 py-1.5 text-xs'>
                            {currentPreview?.referenceCount ?? detail.references.length} 张 · 按已保存顺序发送
                        </p>
                    </div>
                </div>

                <div className='border-wb-border bg-wb-subtle text-wb-ink space-y-1 rounded border p-2 text-xs'>
                    <p className='text-wb-muted text-xs'>
                        设计 v{detail.project.designVersion} · 提示词
                        {detail.prompt.source === 'manual' ? '手动版' : '编译版'} · 锁定项 {detail.lockedFields.length}{' '}
                        个
                    </p>
                    <p className='text-wb-muted text-xs'>
                        参考顺序：
                        {[...detail.references]
                            .sort((a, b) => a.position - b.position)
                            .map(
                                (binding, index) =>
                                    `${index + 1}. ${REFERENCE_PURPOSE_LABELS[binding.purpose]}（${binding.asset.originalName}）`
                            )
                            .join(' / ') || '无'}
                    </p>
                    <div className='flex flex-wrap items-center gap-1.5'>
                        <Badge tone='yellow'>真实调用</Badge>
                        {currentPreview && (
                            <>
                                <Badge>生图 {currentPreview.estimate.imageCalls} 次</Badge>
                                <Badge>审稿 {currentPreview.estimate.reviewCalls} 次</Badge>
                                <Badge tone={currentPreview.estimate.estimatedImageUsd === null ? 'yellow' : 'neutral'}>
                                    图片估算 {formatUsd(currentPreview.estimate.estimatedImageUsd)}
                                </Badge>
                            </>
                        )}
                    </div>
                    {!currentPreview && !previewError && (
                        <p className='text-wb-info text-sm' role='status'>
                            正在估算当前参数，请稍候确认。
                        </p>
                    )}
                    {previewError && <p className='text-wb-error'>{previewError}</p>}
                    {currentPreview && (
                        <>
                            <p className='text-wb-muted'>{currentPreview.estimate.reviewCostNote}</p>
                            <p className='text-wb-muted'>
                                价格表 {currentPreview.estimate.priceTableVersion}：
                                {currentPreview.estimate.priceTableSource}
                            </p>
                            <details>
                                <summary className='text-wb-muted cursor-pointer'>估价假设与不确定性</summary>
                                <ul className='text-wb-muted mt-1 space-y-0.5 text-xs'>
                                    {currentPreview.estimate.assumptions.map((item, index) => (
                                        <li key={index}>• {item}</li>
                                    ))}
                                </ul>
                            </details>
                            {currentPreview.budgetMinUsd !== null && budgetUsd < currentPreview.budgetMinUsd && (
                                <p className='text-wb-error'>
                                    预算低于单张估算（约 {formatUsd(currentPreview.budgetMinUsd)}），服务端会拒绝。
                                </p>
                            )}
                        </>
                    )}
                    <p className='text-wb-muted text-xs'>
                        此面板的估价请求不发送模型调用；提交时服务端会重新计算并校验调用上限。
                    </p>
                </div>

                <label className='border-wb-warning bg-wb-subtle text-wb-warning flex items-start gap-2 rounded border p-2 text-xs'>
                    <input
                        type='checkbox'
                        checked={risk}
                        onChange={(event) => setRisk(event.target.checked)}
                        className='accent-wb-accent mt-0.5'
                    />
                    <span>
                        我确认发起 {params.imageCount} 次生图和 {params.imageCount}{' '}
                        次审稿。图片费用为估算，审稿费用未知。超预算或结果未知时，后续调用会暂停。
                    </span>
                </label>

                <DialogFooter>
                    <Button variant='outline' disabled={busy} onClick={onClose}>
                        取消
                    </Button>
                    <Button disabled={!canSubmit} onClick={() => void submit()}>
                        {busy ? <Spinner label='提交中' /> : '确认生成（真实调用）'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function RevisionDialog({
    onClose,
    detail,
    baseVersion,
    initialSuggestions,
    onAction,
    notify,
    setError
}: {
    onClose: () => void;
    detail: ProjectDetail;
    status: WorkbenchStatus;
    baseVersion: VersionRecord | null;
    initialSuggestions: { change: string; keep: string }[];
    onAction: PanelProps['onAction'];
    notify: (message: string) => void;
    setError: (message: string | null) => void;
}) {
    const baseRun = baseVersion ? (detail.runs.find((run) => run.id === baseVersion.runId) ?? null) : null;
    const suggestedChanges = initialSuggestions.filter((item) => item.change);
    const [change1, setChange1] = React.useState(suggestedChanges[0]?.change ?? '');
    const [change2, setChange2] = React.useState(suggestedChanges[1]?.change ?? '');
    const [submitError, setSubmitError] = React.useState<string | null>(null);
    const [keep, setKeep] = React.useState(
        initialSuggestions
            .map((item) => item.keep)
            .filter(Boolean)
            .join('\n')
    );
    const [budgetUsd, setBudgetUsd] = React.useState(1);
    const [risk, setRisk] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [actionId] = React.useState(() => newActionId());

    if (!baseVersion || !baseRun) return null;
    const base = baseVersion;
    const params = baseRun.snapshot.params;

    async function submit() {
        setSubmitError(null);
        const changePoints = [change1, change2].map((item) => item.trim()).filter(Boolean);
        if (changePoints.length < 1 || changePoints.length > 2) {
            const message = '请填写 1–2 个明确的修改点。';
            setSubmitError(message);
            setError(message);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const response = await onAction('run.create', {
                actionId,
                run: {
                    action: 'revise',
                    baseVersionId: base.id,
                    changePoints,
                    keepPoints: keep
                        .split('\n')
                        .map((item) => item.trim())
                        .filter(Boolean),
                    imageCount: 1,
                    model: params.model,
                    size: params.size,
                    quality: params.quality,
                    background: params.background as 'auto' | 'opaque' | 'transparent',
                    outputFormat: params.outputFormat as 'png' | 'jpeg' | 'webp',
                    moderation: params.moderation as 'auto' | 'low',
                    budgetUsd,
                    riskAcknowledged: risk
                }
            });
            notify(
                response?.reused === true
                    ? '相同修订动作已存在，已返回同一任务。'
                    : '已创建定向修订任务（只执行一次编辑）。'
            );
            onClose();
        } catch (error) {
            const message = error instanceof Error ? error.message : '创建修订失败。';
            setSubmitError(message);
            setError(message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
            <DialogContent className='border-wb-border bg-wb-panel text-wb-ink max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
                <DialogHeader>
                    <DialogTitle>修改这张 · {base.label}</DialogTitle>
                    <DialogDescription>
                        基底固定为版本 {base.label}；参考图按原快照辅助。只执行一次编辑，新版本保留父版本关系。
                    </DialogDescription>
                </DialogHeader>
                {submitError && (
                    <p role='alert' className='text-wb-error text-sm leading-relaxed'>
                        {submitError}
                    </p>
                )}
                <div className='flex flex-col gap-3 sm:flex-row'>
                    <img
                        src={`/api/workbench/assets/${base.assetId}/file`}
                        alt={base.label}
                        className='border-wb-border bg-wb-stage h-32 w-full rounded border object-contain sm:w-56'
                    />
                    <div className='text-wb-muted space-y-1 text-xs'>
                        <p>模型：{params.model}</p>
                        <p>
                            尺寸：{params.size} · 质量：{params.quality}
                        </p>
                        <p>参考图：{baseRun.snapshot.references.length} 张（沿用原快照）</p>
                        <p>动作：1 次图像编辑 + 1 次审稿</p>
                        <p className='text-wb-warning'>锁定项表示流程不擅自改要求，不保证像素完全不变。</p>
                    </div>
                </div>
                <div className='space-y-2'>
                    <div>
                        <p className='text-wb-muted text-xs'>修改点 1（必填）</p>
                        <Textarea
                            aria-label='修改点 1（必填）'
                            rows={2}
                            value={change1}
                            onChange={(event) => setChange1(event.target.value)}
                            className='border-wb-border bg-wb-panel text-sm'
                        />
                    </div>
                    <div>
                        <p className='text-wb-muted text-xs'>修改点 2（可选）</p>
                        <Textarea
                            aria-label='修改点 2（可选）'
                            rows={2}
                            value={change2}
                            onChange={(event) => setChange2(event.target.value)}
                            className='border-wb-border bg-wb-panel text-sm'
                        />
                    </div>
                    <div>
                        <p className='text-wb-muted text-xs'>明确保留项（每行一项）</p>
                        <Textarea
                            aria-label='明确保留项'
                            rows={3}
                            value={keep}
                            onChange={(event) => setKeep(event.target.value)}
                            className='border-wb-border bg-wb-panel text-sm'
                        />
                    </div>
                    <div className='flex items-center gap-2'>
                        <span className='text-wb-muted text-xs'>预算上限（USD）</span>
                        <Input
                            aria-label='预算上限（USD）'
                            type='number'
                            min={0.01}
                            step={0.01}
                            value={budgetUsd}
                            onChange={(event) => setBudgetUsd(Number(event.target.value))}
                            className='border-wb-border bg-wb-panel h-9 w-28 text-sm'
                        />
                    </div>
                </div>
                <label className='border-wb-warning bg-wb-subtle text-wb-warning flex items-start gap-2 rounded border p-2 text-xs'>
                    <input
                        type='checkbox'
                        checked={risk}
                        onChange={(event) => setRisk(event.target.checked)}
                        className='accent-wb-accent mt-0.5'
                    />
                    <span>
                        我确认本次为 1 次编辑 + 1 次审稿；审稿费用未知，图片费用为估算；失败或未知时不会自动重发。
                    </span>
                </label>
                <DialogFooter>
                    <Button variant='outline' disabled={busy} onClick={onClose}>
                        取消
                    </Button>
                    <Button disabled={busy || !risk} onClick={() => void submit()}>
                        {busy ? <Spinner label='提交中' /> : '确认修改（真实调用）'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function RerollDialog({
    onClose,
    detail,
    sourceRun,
    onAction,
    notify,
    setError
}: {
    onClose: () => void;
    detail: ProjectDetail;
    status: WorkbenchStatus;
    sourceRun: RunSummary | null;
    onAction: PanelProps['onAction'];
    notify: (message: string) => void;
    setError: (message: string | null) => void;
}) {
    const [budgetUsd, setBudgetUsd] = React.useState(1);
    const [submitError, setSubmitError] = React.useState<string | null>(null);
    const [risk, setRisk] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [actionId] = React.useState(() => newActionId());

    if (!sourceRun) return null;

    async function submit() {
        if (!sourceRun) return;
        setBusy(true);
        setSubmitError(null);
        setError(null);
        try {
            const response = await onAction('run.create', {
                actionId,
                run: {
                    action: 'reroll',
                    sourceRunId: sourceRun.id,
                    budgetUsd,
                    riskAcknowledged: risk
                }
            });
            notify(
                response?.reused === true
                    ? '相同再抽动作已存在，已返回同一任务。'
                    : '已创建同方案再抽任务；沿用原快照，不调用规划器。'
            );
            onClose();
        } catch (error) {
            const message = error instanceof Error ? error.message : '创建再抽失败。';
            setSubmitError(message);
            setError(message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
            <DialogContent className='border-wb-border bg-wb-panel text-wb-ink sm:max-w-2xl'>
                <DialogHeader>
                    <DialogTitle>按原设置再生成</DialogTitle>
                    <DialogDescription>
                        复用指定运行的已确认提示词、参考组和参数；不调用规划器改方向，创建新的授权运行。
                    </DialogDescription>
                </DialogHeader>
                {submitError && (
                    <p role='alert' className='text-wb-error text-sm leading-relaxed'>
                        {submitError}
                    </p>
                )}
                <div className='border-wb-border bg-wb-subtle text-wb-ink space-y-1 rounded border p-2 text-xs'>
                    <p>
                        来源运行：{sourceRun.id.slice(0, 8)} · {sourceRun.action} · {sourceRun.status}
                    </p>
                    <p>
                        模型/参数：{sourceRun.snapshot.params.model} · {sourceRun.snapshot.params.size} ·{' '}
                        {sourceRun.snapshot.params.quality} · {sourceRun.snapshot.params.imageCount} 张
                    </p>
                    <p>
                        参考顺序：
                        {sourceRun.snapshot.references.length > 0
                            ? sourceRun.snapshot.references
                                  .map((ref) => `${ref.position + 1}.${REFERENCE_PURPOSE_LABELS[ref.purpose]}`)
                                  .join(' / ')
                            : '无'}
                    </p>
                    <p>
                        提示词：{sourceRun.snapshot.prompt.slice(0, 180)}
                        {sourceRun.snapshot.prompt.length > 180 ? '…' : ''}
                    </p>
                    <p className='text-wb-muted'>再次抽卡会创建新的动作键与新的费用估算；不会改写原方案。</p>
                    {sourceRun.items.some((item) => item.status === 'unknown') && (
                        <p className='border-wb-error bg-wb-subtle text-wb-error rounded border p-1.5'>
                            来源运行包含“结果未知”的付费请求。再次提交可能造成上游重复收费，请先核实供应商状态。
                        </p>
                    )}
                </div>
                <div className='flex items-center gap-2'>
                    <span className='text-wb-muted text-xs'>预算上限（USD）</span>
                    <Input
                        aria-label='预算上限（USD）'
                        type='number'
                        min={0.01}
                        step={0.01}
                        value={budgetUsd}
                        onChange={(event) => setBudgetUsd(Number(event.target.value))}
                        className='border-wb-border bg-wb-panel h-9 w-28 text-sm'
                    />
                </div>
                <label className='border-wb-warning bg-wb-subtle text-wb-warning flex items-start gap-2 rounded border p-2 text-xs'>
                    <input
                        type='checkbox'
                        checked={risk}
                        onChange={(event) => setRisk(event.target.checked)}
                        className='accent-wb-accent mt-0.5'
                    />
                    <span>
                        我确认为新的授权运行，包含 {sourceRun.snapshot.params.imageCount}{' '}
                        次生图与审稿；费用为估算，审稿费用未知。
                    </span>
                </label>
                <DialogFooter>
                    <Button variant='outline' disabled={busy} onClick={onClose}>
                        取消
                    </Button>
                    <Button disabled={busy || !risk} onClick={() => void submit()}>
                        {busy ? <Spinner label='提交中' /> : '确认生成（真实调用）'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
