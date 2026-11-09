'use client';

import { Badge, Spinner, type PaidRequest, type PanelProps } from '@/components/workbench/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatUsd, newActionId, projectAction, workbenchFetch } from '@/lib/workbench/client';
import { supportsExtendedQuality, type GptImageModel } from '@/lib/models';
import { validateCustomSize } from '@/lib/size-utils';
import type { CostEstimate, ProjectDetail, RunSummary, VersionRecord, WorkbenchStatus } from '@/lib/workbench/types';
import * as React from 'react';

export function PaidConfirmDialog({
    request,
    onClose
}: {
    request: PaidRequest | null;
    onClose: () => void;
}) {
    const [busy, setBusy] = React.useState(false);
    async function confirm() {
        if (!request) return;
        setBusy(true);
        try {
            await request.onConfirm();
            onClose();
        } finally {
            setBusy(false);
        }
    }
    return (
        <Dialog open={!!request} onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
            <DialogContent className='border-neutral-800 bg-neutral-950'>
                <DialogHeader>
                    <DialogTitle>{request?.title ?? ''}</DialogTitle>
                    <DialogDescription>{request?.description ?? ''}</DialogDescription>
                </DialogHeader>
                <ul className='space-y-1 rounded border border-neutral-800 bg-neutral-900/60 p-2 text-[11px] text-neutral-300'>
                    {request?.lines.map((line, index) => (
                        <li key={index}>• {line}</li>
                    ))}
                </ul>
                <DialogFooter>
                    <Button variant='outline' disabled={busy} onClick={onClose}>
                        取消
                    </Button>
                    <Button disabled={busy} onClick={() => void confirm()}>
                        {busy ? <Spinner label='执行中' /> : request?.confirmLabel ?? '确认'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function ModeSwitchDialog({
    status,
    onClose
}: {
    status: WorkbenchStatus;
    onClose: () => void;
}) {
    const target = status.mock ? 'real' : 'mock';
    const [confirmed, setConfirmed] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState<string | null>(null);
    const [timedOut, setTimedOut] = React.useState(false);
    const manualCommand =
        target === 'mock'
            ? "$env:WORKBENCH_MOCK='1'; node scripts/start-local.mjs"
            : 'node scripts/start-local.mjs';

    async function switchMode() {
        setBusy(true);
        setMessage(null);
        setTimedOut(false);
        try {
            await workbenchFetch<{ ok: boolean; message?: string }>('/api/workbench/mode', {
                method: 'POST',
                body: JSON.stringify({ mode: target, confirm: true })
            });
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                try {
                    const response = await workbenchFetch<{ status: WorkbenchStatus }>('/api/workbench/status');
                    if (response.status.mock === (target === 'mock')) {
                        window.location.assign('/workbench');
                        return;
                    }
                } catch {
                    // Web is restarting.
                }
            }
            setTimedOut(true);
            setBusy(false);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : '切换模式失败。');
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
            <DialogContent className='max-w-xl border-neutral-800 bg-neutral-950'>
                <DialogHeader>
                    <DialogTitle>切换运行模式</DialogTitle>
                    <DialogDescription>
                        当前：{status.mock ? 'Mock 模式（本地夹具，不调用真实 API）' : '真实模式（使用 .env.local 配置）'}
                    </DialogDescription>
                </DialogHeader>
                <div className='space-y-2 text-[11px] text-neutral-300'>
                    <p>
                        目标：{target === 'mock' ? 'Mock 模式' : '真实模式'}。切换会停止当前 Web 与 worker，并用对应数据目录重启；
                        {target === 'mock'
                            ? 'Mock 数据在 .workbench-data/mock，不会读取真实 Key。'
                            : '真实模式读取 .env.local 中的 Key，任何已确认的规划/搜索/审稿/生图都可能产生真实费用。'}
                    </p>
                    <p className='text-neutral-500'>
                        切换要求当前没有排队或执行中的任务。发布中的在途请求不会被自动取消；如有任务请先等待或停止。
                    </p>
                    {target === 'real' && (
                        <p className='rounded border border-yellow-700/40 bg-yellow-950/20 p-2 text-yellow-100'>
                            真实模式的默认规划/分析/审稿/搜索模型为 gpt-6.1-sol（也可在顶栏切换），生图仍为 gpt-image 模型。
                        </p>
                    )}
                    {!status.autoRestartAvailable && (
                        <div className='space-y-1 rounded border border-blue-700/40 bg-blue-950/20 p-2 text-blue-100'>
                            <p>未检测到可自动重启的启动器（scripts/start-local.mjs）。请手动停止当前服务后运行：</p>
                            <code className='block break-all rounded bg-black/40 px-2 py-1 text-[10px]'>{manualCommand}</code>
                            <Button
                                size='sm'
                                variant='outline'
                                className='h-6 border-blue-600/50 px-2 text-[10px] text-blue-100'
                                onClick={() => {
                                    void navigator.clipboard.writeText(manualCommand);
                                    setMessage('命令已复制。');
                                }}>
                                复制命令
                            </Button>
                        </div>
                    )}
                    {status.autoRestartAvailable && (
                        <label className='flex items-start gap-2 rounded border border-neutral-700 bg-neutral-900/60 p-2'>
                            <input
                                type='checkbox'
                                checked={confirmed}
                                onChange={(event) => setConfirmed(event.target.checked)}
                                className='mt-0.5 accent-amber-500'
                            />
                            <span>
                                {target === 'mock'
                                    ? '我确认切换到 Mock 模式，之后不会调用真实 API。'
                                    : '我确认切换到真实模式；之后的付费操作会产生真实费用，且需要我逐次确认。'}
                            </span>
                        </label>
                    )}
                    {message && <p className='text-[11px] text-red-300'>{message}</p>}
                    {timedOut && (
                        <div className='rounded border border-yellow-700/40 bg-yellow-950/20 p-2 text-yellow-100'>
                            未在 30 秒内检测到新模式。请查看启动窗口是否报错，或手动重启：
                            <code className='mt-1 block break-all rounded bg-black/40 px-2 py-1 text-[10px]'>{manualCommand}</code>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant='outline' disabled={busy} onClick={onClose}>
                        关闭
                    </Button>
                    {status.autoRestartAvailable && (
                        <Button
                            disabled={busy || !confirmed}
                            onClick={() => void switchMode()}>
                            {busy ? <Spinner label='正在重启' /> : `切换到${target === 'mock' ? ' Mock' : '真实'}模式`}
                        </Button>
                    )}
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
            <DialogContent className='border-neutral-800 bg-neutral-950'>
                <DialogHeader>
                    <DialogTitle>规划设置</DialogTitle>
                    <DialogDescription>
                        仅影响设计卡规划与自然语言修改；不会生图、不会搜索。
                    </DialogDescription>
                </DialogHeader>
                <div className='space-y-3'>
                    <div className='space-y-1'>
                        <p className='text-[11px] text-neutral-400'>规划模型</p>
                        <Select value={nextModel} onValueChange={setNextModel}>
                            <SelectTrigger className='border-neutral-700 bg-neutral-900 text-xs'>
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
                        <p className='text-[10px] text-neutral-500'>
                            允许列表由 WORKBENCH_PLANNER_MODELS 控制；服务端会拒绝列表外模型。
                        </p>
                    </div>
                    <div className='space-y-1'>
                        <p className='text-[11px] text-neutral-400'>思考强度（reasoning.effort）</p>
                        <Select value={nextEffort} onValueChange={setNextEffort}>
                            <SelectTrigger className='border-neutral-700 bg-neutral-900 text-xs'>
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
                        <p className='text-[10px] text-neutral-500'>
                            gpt-6.1-sol 支持 low / medium / high / xhigh / max，默认 medium，不支持 none。非 reasoning 模型可能拒绝该参数。
                        </p>
                    </div>
                    {status.mock && (
                        <p className='rounded border border-purple-700/40 bg-purple-950/20 p-2 text-[10px] text-purple-200'>
                            Mock 模式只记录选择，不发送模型请求；切换到真实模式后生效。
                        </p>
                    )}
                </div>
                <DialogFooter>
                    <Button variant='outline' onClick={onClose}>取消</Button>
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
    const [preview, setPreview] = React.useState<{ estimate: CostEstimate; budgetMinUsd: number | null; promptStale: boolean; referenceCount: number } | null>(null);
    const [previewError, setPreviewError] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [actionId] = React.useState(() => newActionId());

    const resolvedSize = resolveSize(params.size, width, height);
    const customValidation = params.size === 'custom' ? validateCustomSize(width, height) : { valid: true as const };

    React.useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            if (params.size === 'custom' && !customValidation.valid) return;
            void projectAction<{ preview: { estimate: CostEstimate; budgetMinUsd: number | null; promptStale: boolean; referenceCount: number } }>(
                detail.project.id,
                {
                    action: 'run.estimate',
                    run: {
                        action: 'generate',
                        ...params,
                        size: resolvedSize,
                        budgetUsd,
                        riskAcknowledged: true
                    }
                }
            )
                .then((response) => {
                    if (!cancelled) setPreview(response.preview);
                })
                .catch((error: unknown) => {
                    if (!cancelled) setPreviewError(error instanceof Error ? error.message : '估价失败。');
                });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [detail.project.id, params, resolvedSize, width, height, budgetUsd, customValidation.valid]);

    async function submit() {
        setBusy(true);
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
            notify(reused ? '相同动作已存在，已返回同一任务（未重复提交）。' : '已创建生成任务；可关闭页面，worker 会继续执行。');
            onClose();
        } catch (error) {
            setError(error instanceof Error ? error.message : '创建任务失败。');
        } finally {
            setBusy(false);
        }
    }

    const qualityOptions = status.models.quality.filter(
        (quality) => supportsExtendedQuality(params.model as GptImageModel) || (quality !== 'xhigh' && quality !== 'max')
    );
    const canSubmit =
        !busy &&
        !detail.prompt.stale &&
        detail.prompt.text.trim().length > 0 &&
        (params.size !== 'custom' || customValidation.valid) &&
        budgetUsd > 0 &&
        (status.mock || risk);

    return (
        <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
            <DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto border-neutral-800 bg-neutral-950'>
                <DialogHeader>
                    <DialogTitle>确认生成批次</DialogTitle>
                    <DialogDescription>
                        确认后保存不可变快照；之后再改草稿或参考组不会影响本批次。
                    </DialogDescription>
                </DialogHeader>

                {detail.prompt.stale && (
                    <div className='rounded border border-red-700/50 bg-red-950/30 p-2 text-[11px] text-red-200'>
                        提示词已过期。请先在提示词面板保留手动版或重新编译后再生成。
                    </div>
                )}

                <div className='grid gap-3 sm:grid-cols-2'>
                    <div className='space-y-1'>
                        <p className='text-[11px] text-neutral-400'>模型</p>
                        <Select value={params.model} onValueChange={(value) => setParams((current) => ({ ...current, model: value }))}>
                            <SelectTrigger className='border-neutral-700 bg-neutral-900 text-xs'>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {status.models.image.map((model) => (
                                    <SelectItem key={model} value={model}>{model}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className='space-y-1'>
                        <p className='text-[11px] text-neutral-400'>尺寸</p>
                        <Select value={params.size} onValueChange={(value) => setParams((current) => ({ ...current, size: value }))}>
                            <SelectTrigger className='border-neutral-700 bg-neutral-900 text-xs'>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {SIZE_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {params.size === 'custom' && (
                            <div className='flex items-center gap-1'>
                                <Input type='number' value={width} onChange={(event) => setWidth(Number(event.target.value))} className='h-8 w-24 border-neutral-700 bg-neutral-900 text-xs' />
                                <span className='text-xs text-neutral-500'>×</span>
                                <Input type='number' value={height} onChange={(event) => setHeight(Number(event.target.value))} className='h-8 w-24 border-neutral-700 bg-neutral-900 text-xs' />
                            </div>
                        )}
                        {params.size === 'custom' && !customValidation.valid && (
                            <p className='text-[10px] text-red-300'>{customValidation.reason}</p>
                        )}
                    </div>
                    <div className='space-y-1'>
                        <p className='text-[11px] text-neutral-400'>质量</p>
                        <Select value={params.quality} onValueChange={(value) => setParams((current) => ({ ...current, quality: value }))}>
                            <SelectTrigger className='border-neutral-700 bg-neutral-900 text-xs'>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {qualityOptions.map((quality) => (
                                    <SelectItem key={quality} value={quality}>{quality}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className='space-y-1'>
                        <p className='text-[11px] text-neutral-400'>数量（独立结果）</p>
                        <Select value={String(params.imageCount)} onValueChange={(value) => setParams((current) => ({ ...current, imageCount: Number(value) === 2 ? 2 : 1 }))}>
                            <SelectTrigger className='border-neutral-700 bg-neutral-900 text-xs'>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value='1'>1 张（默认）</SelectItem>
                                <SelectItem value='2'>2 张（两张独立请求）</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className='space-y-1'>
                        <p className='text-[11px] text-neutral-400'>本次预算上限（USD，应用内约束）</p>
                        <Input
                            type='number'
                            min={0.01}
                            step={0.01}
                            value={budgetUsd}
                            onChange={(event) => setBudgetUsd(Number(event.target.value))}
                            className='h-8 border-neutral-700 bg-neutral-900 text-xs'
                        />
                    </div>
                    <div className='space-y-1'>
                        <p className='text-[11px] text-neutral-400'>参考图</p>
                        <p className='rounded border border-neutral-800 bg-neutral-900/60 px-2 py-1.5 text-[11px] text-neutral-300'>
                            {preview?.referenceCount ?? detail.references.length} 张 · 按已保存顺序发送
                        </p>
                    </div>
                </div>

                <div className='space-y-1 rounded border border-neutral-800 bg-neutral-900/50 p-2 text-[11px] text-neutral-300'>
                    <p className='text-[10px] text-neutral-400'>
                        设计 v{detail.project.designVersion} · 提示词{detail.prompt.source === 'manual' ? '手动版' : '编译版'} ·
                        锁定项 {detail.lockedFields.length} 个
                    </p>
                    <p className='text-[10px] text-neutral-500'>
                        参考顺序：
                        {[...detail.references]
                            .sort((a, b) => a.position - b.position)
                            .map((binding, index) => `${index + 1}. ${binding.purpose}（${binding.asset.originalName}）`)
                            .join(' / ') || '无'}
                    </p>
                    <div className='flex flex-wrap items-center gap-1.5'>
                        <Badge tone={status.mock ? 'purple' : 'yellow'}>{status.mock ? 'Mock 模式：不会调用真实 API' : '真实调用'}</Badge>
                        {preview && (
                            <>
                                <Badge>生图 {preview.estimate.imageCalls} 次</Badge>
                                <Badge>审稿 {preview.estimate.reviewCalls} 次</Badge>
                                <Badge tone={preview.estimate.estimatedImageUsd === null ? 'yellow' : 'neutral'}>
                                    图片估算 {formatUsd(preview.estimate.estimatedImageUsd)}
                                </Badge>
                            </>
                        )}
                    </div>
                    {previewError && <p className='text-red-300'>{previewError}</p>}
                    {preview && (
                        <>
                            <p className='text-neutral-400'>{preview.estimate.reviewCostNote}</p>
                            <p className='text-neutral-500'>价格表 {preview.estimate.priceTableVersion}：{preview.estimate.priceTableSource}</p>
                            <details>
                                <summary className='cursor-pointer text-neutral-500'>估价假设与不确定性</summary>
                                <ul className='mt-1 space-y-0.5 text-[10px] text-neutral-500'>
                                    {preview.estimate.assumptions.map((item, index) => (
                                        <li key={index}>• {item}</li>
                                    ))}
                                </ul>
                            </details>
                            {preview.budgetMinUsd !== null && budgetUsd < preview.budgetMinUsd && (
                                <p className='text-red-300'>预算低于单张估算（约 {formatUsd(preview.budgetMinUsd)}），服务端会拒绝。</p>
                            )}
                        </>
                    )}
                    <p className='text-[10px] text-neutral-500'>此面板的估价请求不发送模型调用；提交时服务端会重新计算并校验调用上限。</p>
                </div>

                {!status.mock && (
                    <label className='flex items-start gap-2 rounded border border-yellow-700/40 bg-yellow-950/20 p-2 text-[11px] text-yellow-100'>
                        <input type='checkbox' checked={risk} onChange={(event) => setRisk(event.target.checked)} className='mt-0.5 accent-amber-500' />
                        <span>
                            我确认：本次包含 {params.imageCount} 次生图与 {params.imageCount} 次审稿调用；审稿文本模型费用未知，图片费用为估算而非账单。超出预算或结果未知时系统会暂停后续付费调用。
                        </span>
                    </label>
                )}

                <DialogFooter>
                    <Button variant='outline' disabled={busy} onClick={onClose}>取消</Button>
                    <Button disabled={!canSubmit} onClick={() => void submit()}>
                        {busy ? <Spinner label='提交中' /> : status.mock ? '确认生成（Mock）' : '确认生成（真实调用）'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function RevisionDialog({
    onClose,
    detail,
    status,
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
    const baseRun = baseVersion ? detail.runs.find((run) => run.id === baseVersion.runId) ?? null : null;
    const suggestedChanges = initialSuggestions.filter((item) => item.change);
    const [change1, setChange1] = React.useState(suggestedChanges[0]?.change ?? '');
    const [change2, setChange2] = React.useState(suggestedChanges[1]?.change ?? '');
    const [keep, setKeep] = React.useState(
        initialSuggestions.map((item) => item.keep).filter(Boolean).join('\n')
    );
    const [budgetUsd, setBudgetUsd] = React.useState(1);
    const [risk, setRisk] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [actionId] = React.useState(() => newActionId());

    if (!baseVersion || !baseRun) return null;
    const base = baseVersion;
    const params = baseRun.snapshot.params;

    async function submit() {
        const changePoints = [change1, change2].map((item) => item.trim()).filter(Boolean);
        if (changePoints.length < 1 || changePoints.length > 2) {
            setError('请填写 1–2 个明确的修改点。');
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
                    keepPoints: keep.split('\n').map((item) => item.trim()).filter(Boolean),
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
            notify(response?.reused === true ? '相同修订动作已存在，已返回同一任务。' : '已创建定向修订任务（只执行一次编辑）。');
            onClose();
        } catch (error) {
            setError(error instanceof Error ? error.message : '创建修订失败。');
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
            <DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto border-neutral-800 bg-neutral-950'>
                <DialogHeader>
                    <DialogTitle>定向修订 {base.label}</DialogTitle>
                    <DialogDescription>
                        基底固定为版本 {base.label}；参考图按原快照辅助。只执行一次编辑，新版本保留父版本关系。
                    </DialogDescription>
                </DialogHeader>
                <div className='flex gap-3'>
                    <img
                        src={`/api/workbench/assets/${base.assetId}/file`}
                        alt={base.label}
                        className='h-32 w-56 rounded border border-neutral-800 object-contain'
                    />
                    <div className='space-y-1 text-[11px] text-neutral-400'>
                        <p>模型：{params.model}</p>
                        <p>尺寸：{params.size} · 质量：{params.quality}</p>
                        <p>参考图：{baseRun.snapshot.references.length} 张（沿用原快照）</p>
                        <p>动作：1 次图像编辑 + 1 次审稿</p>
                        <p className='text-yellow-200/80'>锁定项表示流程不擅自改要求，不保证像素完全不变。</p>
                    </div>
                </div>
                <div className='space-y-2'>
                    <div>
                        <p className='text-[11px] text-neutral-400'>修改点 1（必填）</p>
                        <Textarea rows={2} value={change1} onChange={(event) => setChange1(event.target.value)} className='border-neutral-700 bg-neutral-900 text-xs' />
                    </div>
                    <div>
                        <p className='text-[11px] text-neutral-400'>修改点 2（可选）</p>
                        <Textarea rows={2} value={change2} onChange={(event) => setChange2(event.target.value)} className='border-neutral-700 bg-neutral-900 text-xs' />
                    </div>
                    <div>
                        <p className='text-[11px] text-neutral-400'>明确保留项（每行一项）</p>
                        <Textarea rows={3} value={keep} onChange={(event) => setKeep(event.target.value)} className='border-neutral-700 bg-neutral-900 text-xs' />
                    </div>
                    <div className='flex items-center gap-2'>
                        <span className='text-[11px] text-neutral-400'>预算上限（USD）</span>
                        <Input type='number' min={0.01} step={0.01} value={budgetUsd} onChange={(event) => setBudgetUsd(Number(event.target.value))} className='h-8 w-28 border-neutral-700 bg-neutral-900 text-xs' />
                    </div>
                </div>
                {!status.mock && (
                    <label className='flex items-start gap-2 rounded border border-yellow-700/40 bg-yellow-950/20 p-2 text-[11px] text-yellow-100'>
                        <input type='checkbox' checked={risk} onChange={(event) => setRisk(event.target.checked)} className='mt-0.5 accent-amber-500' />
                        <span>我确认本次为 1 次编辑 + 1 次审稿；审稿费用未知，图片费用为估算；失败或未知时不会自动重发。</span>
                    </label>
                )}
                <DialogFooter>
                    <Button variant='outline' disabled={busy} onClick={onClose}>取消</Button>
                    <Button disabled={busy || (!status.mock && !risk)} onClick={() => void submit()}>
                        {busy ? <Spinner label='提交中' /> : '确认修订'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function RerollDialog({
    onClose,
    detail,
    status,
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
    const [risk, setRisk] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [actionId] = React.useState(() => newActionId());

    if (!sourceRun) return null;

    async function submit() {
        if (!sourceRun) return;
        setBusy(true);
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
            notify(response?.reused === true ? '相同再抽动作已存在，已返回同一任务。' : '已创建同方案再抽任务；沿用原快照，不调用规划器。');
            onClose();
        } catch (error) {
            setError(error instanceof Error ? error.message : '创建再抽失败。');
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
            <DialogContent className='max-w-2xl border-neutral-800 bg-neutral-950'>
                <DialogHeader>
                    <DialogTitle>同方案再抽</DialogTitle>
                    <DialogDescription>复用指定运行的已确认提示词、参考组和参数；不调用规划器改方向，创建新的授权运行。</DialogDescription>
                </DialogHeader>
                <div className='space-y-1 rounded border border-neutral-800 bg-neutral-900/50 p-2 text-[11px] text-neutral-300'>
                    <p>来源运行：{sourceRun.id.slice(0, 8)} · {sourceRun.action} · {sourceRun.status}</p>
                    <p>模型/参数：{sourceRun.snapshot.params.model} · {sourceRun.snapshot.params.size} · {sourceRun.snapshot.params.quality} · {sourceRun.snapshot.params.imageCount} 张</p>
                    <p>参考顺序：{sourceRun.snapshot.references.length > 0 ? sourceRun.snapshot.references.map((ref) => `${ref.position + 1}.${ref.purpose}`).join(' / ') : '无'}</p>
                    <p>提示词：{sourceRun.snapshot.prompt.slice(0, 180)}{sourceRun.snapshot.prompt.length > 180 ? '…' : ''}</p>
                    <p className='text-neutral-500'>再次抽卡会创建新的动作键与新的费用估算；不会改写原方案。</p>
                    {sourceRun.items.some((item) => item.status === 'unknown') && (
                        <p className='rounded border border-red-700/50 bg-red-950/30 p-1.5 text-red-200'>
                            来源运行包含“结果未知”的付费请求。再次提交可能造成上游重复收费，请先核实供应商状态。
                        </p>
                    )}
                </div>
                <div className='flex items-center gap-2'>
                    <span className='text-[11px] text-neutral-400'>预算上限（USD）</span>
                    <Input type='number' min={0.01} step={0.01} value={budgetUsd} onChange={(event) => setBudgetUsd(Number(event.target.value))} className='h-8 w-28 border-neutral-700 bg-neutral-900 text-xs' />
                </div>
                {!status.mock && (
                    <label className='flex items-start gap-2 rounded border border-yellow-700/40 bg-yellow-950/20 p-2 text-[11px] text-yellow-100'>
                        <input type='checkbox' checked={risk} onChange={(event) => setRisk(event.target.checked)} className='mt-0.5 accent-amber-500' />
                        <span>我确认为新的授权运行，包含 {sourceRun.snapshot.params.imageCount} 次生图与审稿；费用为估算，审稿费用未知。</span>
                    </label>
                )}
                <DialogFooter>
                    <Button variant='outline' disabled={busy} onClick={onClose}>取消</Button>
                    <Button disabled={busy || (!status.mock && !risk)} onClick={() => void submit()}>
                        {busy ? <Spinner label='提交中' /> : '确认再抽'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

