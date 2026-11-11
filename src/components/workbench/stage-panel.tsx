'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge, RunStatusBadge, Section, type PanelProps } from '@/components/workbench/shared';
import { formatTime } from '@/lib/workbench/client';
import type { VersionRecord } from '@/lib/workbench/types';
import { Expand, ImageIcon } from 'lucide-react';
import * as React from 'react';

type StageProps = PanelProps & {
    onOpenGenerate: () => void;
    onOpenReview: () => void;
    onOpenFork: () => void;
    onOpenRevision: (versionId: string, suggestions?: { change: string; keep: string }[]) => void;
    onOpenReroll: (runId: string) => void;
};

const ACTION_LABELS = { generate: '生成', revise: '修改', reroll: '按原设置生成' };
const ITEM_LABELS: Record<string, string> = {
    pending: '等待执行',
    sending: '请求中',
    success: '成功',
    failed: '失败',
    unknown: '结果未知',
    skipped: '已跳过',
    review_unavailable: '审稿暂不可用'
};

export function StagePanel({
    detail,
    status,
    busy,
    selectedVersionId,
    onSelectVersion,
    onAction,
    onOpenGenerate,
    onOpenReview,
    onOpenFork,
    onOpenRevision,
    onOpenReroll,
    notify,
    setError
}: StageProps) {
    const versions = detail.versions;
    const selected =
        versions.find((version) => version.id === selectedVersionId) ?? versions[versions.length - 1] ?? null;
    const [compareA, setCompareA] = React.useState('');
    const [compareB, setCompareB] = React.useState('');
    const [comparing, setComparing] = React.useState(false);
    const [recordsOpen, setRecordsOpen] = React.useState(false);
    const [expanded, setExpanded] = React.useState(false);
    const [backdrop, setBackdrop] = React.useState<'dark' | 'light' | 'checker'>('dark');
    const [localBusy, setLocalBusy] = React.useState(false);
    const latestRun = detail.runs[0];
    const selectedRun = detail.runs.find((run) => run.id === selected?.runId);
    const repeatRun = selectedRun?.action === 'revise' ? null : selectedRun;
    const pausedUnknown = detail.runs.some((run) => run.status === 'paused_unknown');
    const pausedBudget = detail.runs.some((run) => run.status === 'paused_budget');
    const activeRun = detail.runs.find((run) => run.status === 'running' || run.status === 'queued');
    const canGenerate = status.imageApiEnabled && status.apiKeyConfigured;
    const needsPrompt = !detail.prompt.text.trim() || detail.prompt.stale;
    let taskMessage = '';
    if (pausedUnknown) taskMessage = '有请求结果待核实。任务已暂停，不会自动重发。';
    else if (pausedBudget) taskMessage = '费用或预算需要核实，任务已暂停。';
    else if (activeRun?.stopRequested) taskMessage = '正在等待已发出的请求返回。';
    else if (activeRun?.items.some((item) => item.status === 'sending' && item.kind === 'image'))
        taskMessage = '正在生成图片。';
    else if (activeRun?.items.some((item) => item.status === 'sending' && item.kind === 'review'))
        taskMessage = '图片已保存，正在审稿。';
    else if (activeRun) taskMessage = '等待执行。';
    else if (latestRun?.status === 'failed' || latestRun?.status === 'partial') taskMessage = '上次任务有步骤未完成。';
    const versionA =
        versions.find((version) => version.id === (compareA || detail.project.baselineVersionId || versions[0]?.id)) ??
        null;
    const versionB = versions.find((version) => version.id === (compareB || selected?.id || versions[1]?.id)) ?? null;
    const stageClass =
        backdrop === 'checker' ? 'bg-checkerboard' : backdrop === 'light' ? 'bg-[#DDE0E3]' : 'bg-wb-stage';

    async function runAction(action: string, payload: Record<string, unknown>, message: string) {
        setLocalBusy(true);
        try {
            const result = await onAction(action, payload);
            if (result) notify(message);
        } catch (error) {
            setError(error instanceof Error ? error.message : '操作未完成，请刷新核对状态。');
        } finally {
            setLocalBusy(false);
        }
    }

    return (
        <div className='min-w-0 space-y-4'>
            <section className='wb-gallery' aria-label='作品'>
                {selected ? (
                    <button
                        type='button'
                        className={`wb-image-stage ${stageClass}`}
                        style={{ aspectRatio: `${selected.asset.width || 16} / ${selected.asset.height || 9}` }}
                        onClick={() => setExpanded(true)}
                        aria-label={`放大查看 ${selected.label}`}>
                        <img
                            src={`/api/workbench/assets/${selected.assetId}/file`}
                            alt={`当前作品 ${selected.label}`}
                        />
                        <span className='wb-image-expand' aria-hidden='true'>
                            <Expand className='size-4' />
                        </span>
                    </button>
                ) : (
                    <div className='wb-empty-stage'>
                        <ImageIcon className='size-7' aria-hidden='true' />
                        <p>{activeRun ? '正在准备第一张图' : '还没有作品'}</p>
                    </div>
                )}
                <div className='wb-gallery-footer'>
                    {versions.length > 0 && (
                        <div className='wb-version-strip' role='group' aria-label='作品版本'>
                            {versions.map((version) => (
                                <VersionCard
                                    key={version.id}
                                    version={version}
                                    selected={selected?.id === version.id}
                                    onSelect={() => onSelectVersion(version.id)}
                                />
                            ))}
                        </div>
                    )}
                    <div className='wb-gallery-actions'>
                        {selected && (
                            <Button variant='ghost' onClick={onOpenReview}>
                                审稿
                            </Button>
                        )}
                        <details className='wb-more'>
                            <summary>更多</summary>
                            <div className='wb-more-panel'>
                                {selected && (
                                    <>
                                        <Button
                                            variant='ghost'
                                            disabled={busy || !canGenerate}
                                            onClick={onOpenGenerate}>
                                            生成新图
                                        </Button>
                                        {repeatRun && (
                                            <Button
                                                variant='ghost'
                                                disabled={busy || !canGenerate}
                                                onClick={() => onOpenReroll(repeatRun.id)}>
                                                按原设置再生成
                                            </Button>
                                        )}
                                        <Button variant='ghost' asChild>
                                            <a href={`/api/workbench/versions/${selected.id}/download`}>下载原图</a>
                                        </Button>
                                        <Button variant='ghost' asChild>
                                            <a href={`/api/workbench/versions/${selected.id}/download?format=info`}>
                                                下载记录
                                            </a>
                                        </Button>
                                        {versions.length >= 2 && (
                                            <Button
                                                variant='ghost'
                                                onClick={() => {
                                                    setCompareA(selected.id);
                                                    setCompareB(
                                                        (selected.isBaseline
                                                            ? null
                                                            : detail.project.baselineVersionId) ||
                                                            versions.find((version) => version.id !== selected.id)
                                                                ?.id ||
                                                            ''
                                                    );
                                                    setComparing(true);
                                                }}>
                                                对比版本
                                            </Button>
                                        )}
                                        {!selected.isBaseline && (
                                            <Button
                                                variant='ghost'
                                                disabled={busy || localBusy}
                                                onClick={() =>
                                                    void runAction(
                                                        'version.baseline',
                                                        { versionId: selected.id },
                                                        `已将 ${selected.label} 设为基准。`
                                                    )
                                                }>
                                                设为基准
                                            </Button>
                                        )}
                                        <label className='wb-backdrop-option'>
                                            预览背景
                                            <select
                                                value={backdrop}
                                                onChange={(event) =>
                                                    setBackdrop(event.target.value as typeof backdrop)
                                                }>
                                                <option value='dark'>深灰</option>
                                                <option value='light'>浅灰</option>
                                                <option value='checker'>棋盘格</option>
                                            </select>
                                        </label>
                                    </>
                                )}
                                {detail.runs.length > 0 && !taskMessage && (
                                    <Button variant='ghost' onClick={() => setRecordsOpen(true)}>
                                        运行记录
                                    </Button>
                                )}
                                <Button variant='ghost' disabled={busy} onClick={onOpenFork}>
                                    从此项目新建
                                </Button>
                            </div>
                        </details>
                        <Button
                            disabled={busy || (!canGenerate && (!!selected || !needsPrompt))}
                            onClick={selected ? () => onOpenRevision(selected.id) : onOpenGenerate}>
                            {selected ? '修改这张' : needsPrompt ? '准备提示词' : '生成图片'}
                        </Button>
                    </div>
                </div>
                {(taskMessage || !canGenerate) && (
                    <div className='wb-gallery-status' aria-live='polite'>
                        {taskMessage && (
                            <div className={pausedUnknown || pausedBudget ? 'text-wb-warning' : 'text-wb-muted'}>
                                <span>{taskMessage}</span>
                                <button
                                    type='button'
                                    className='text-wb-accent ml-2 underline underline-offset-4'
                                    onClick={() => setRecordsOpen(true)}>
                                    查看记录
                                </button>
                            </div>
                        )}
                        {!canGenerate && <p className='text-wb-warning'>生成服务未配置，请查看设置。</p>}
                    </div>
                )}
            </section>

            {versions.length >= 2 && (
                <Dialog open={comparing} onOpenChange={setComparing}>
                    <DialogContent className='border-wb-border bg-wb-panel text-wb-ink sm:max-w-5xl'>
                        <DialogHeader>
                            <DialogTitle>对比版本</DialogTitle>
                            <DialogDescription className='sr-only'>选择两张作品并排查看</DialogDescription>
                        </DialogHeader>
                        <Section
                            title='选择版本'
                            actions={
                                <div className='flex gap-2'>
                                    <Select value={versionA?.id} onValueChange={setCompareA}>
                                        <SelectTrigger
                                            aria-label='左侧对比版本'
                                            className='border-wb-border bg-wb-panel h-9 w-28 text-xs'>
                                            <SelectValue placeholder='左侧版本' />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {versions.map((version) => (
                                                <SelectItem key={version.id} value={version.id}>
                                                    {version.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Select value={versionB?.id} onValueChange={setCompareB}>
                                        <SelectTrigger
                                            aria-label='右侧对比版本'
                                            className='border-wb-border bg-wb-panel h-9 w-28 text-xs'>
                                            <SelectValue placeholder='右侧版本' />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {versions.map((version) => (
                                                <SelectItem key={version.id} value={version.id}>
                                                    {version.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            }>
                            <div className='grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2'>
                                {[versionA, versionB].map((version, index) =>
                                    version ? (
                                        <figure key={`${version.id}-${index}`} className='min-w-0 space-y-2'>
                                            <figcaption className='text-wb-muted flex flex-wrap items-center justify-between gap-1 text-xs'>
                                                <span className='text-wb-ink font-medium'>
                                                    {version.label}
                                                    {version.isBaseline ? ' · 基准' : ''}
                                                </span>
                                                <span>
                                                    {version.asset.width} × {version.asset.height}
                                                </span>
                                            </figcaption>
                                            <div
                                                className={`flex aspect-square items-center justify-center rounded-md ${stageClass}`}>
                                                <img
                                                    src={`/api/workbench/assets/${version.assetId}/file`}
                                                    alt={`对比作品 ${version.label}`}
                                                    className='h-full w-full object-contain'
                                                />
                                            </div>
                                            <p className='text-wb-muted text-xs leading-relaxed'>
                                                {version.review?.summary ??
                                                    (version.reviewStatus === 'pending'
                                                        ? '审稿尚未完成'
                                                        : '审稿暂不可用')}
                                            </p>
                                        </figure>
                                    ) : null
                                )}
                            </div>
                        </Section>
                    </DialogContent>
                </Dialog>
            )}

            <Dialog open={recordsOpen} onOpenChange={setRecordsOpen}>
                <DialogContent className='border-wb-border bg-wb-panel text-wb-ink sm:max-w-2xl'>
                    <DialogHeader>
                        <DialogTitle>运行记录</DialogTitle>
                        <DialogDescription className='sr-only'>查看生成请求、费用估算和任务状态</DialogDescription>
                    </DialogHeader>
                    {detail.runs.length === 0 ? (
                        <p className='text-wb-muted text-sm'>还没有运行记录。</p>
                    ) : (
                        <ul className='space-y-3'>
                            {detail.runs.map((run) => {
                                const successImages = run.items.filter(
                                    (item) => item.kind === 'image' && item.status === 'success'
                                ).length;
                                const failedImages = run.items.filter(
                                    (item) =>
                                        item.kind === 'image' && (item.status === 'failed' || item.status === 'skipped')
                                ).length;
                                const unknown = run.items.some((item) => item.status === 'unknown');
                                const active = ['queued', 'running'].includes(run.status);
                                const failedItems = run.items.filter(
                                    (item) => item.errorMessage || item.status === 'unknown'
                                );
                                return (
                                    <li key={run.id} className='border-wb-border bg-wb-panel rounded-md border p-3'>
                                        <div className='flex flex-wrap items-center gap-2 text-xs'>
                                            <RunStatusBadge status={run.status} />
                                            <Badge>{ACTION_LABELS[run.action]}</Badge>
                                            <span className='text-wb-muted'>
                                                {formatTime(run.createdAt)} · 成功 {successImages} / 失败或跳过{' '}
                                                {failedImages}
                                            </span>
                                        </div>
                                        {active && (
                                            <p role='status' className='text-wb-info mt-2 text-sm'>
                                                {run.stopRequested
                                                    ? '已请求停止，等待在途结果；晚到的成功图片仍会保存。'
                                                    : run.items.some(
                                                            (item) => item.status === 'sending' && item.kind === 'image'
                                                        )
                                                      ? '等待图像返回'
                                                      : run.items.some(
                                                              (item) =>
                                                                  item.status === 'sending' && item.kind === 'review'
                                                          )
                                                        ? '正在审稿，图片已保存'
                                                        : '等待下一步骤执行'}
                                            </p>
                                        )}
                                        {unknown && (
                                            <p className='text-wb-warning mt-2 text-sm'>
                                                请求结果未知，已暂停核实。不会自动重发，请保留原始请求记录。
                                            </p>
                                        )}
                                        {run.status === 'paused_budget' && (
                                            <p className='text-wb-warning mt-2 text-sm'>
                                                预算或费用检查暂停，后续调用尚未执行。
                                            </p>
                                        )}
                                        {run.status === 'stopped' && (
                                            <p className='text-wb-muted mt-2 text-sm'>
                                                已停止后续步骤；在途请求可能继续计费，晚到成功结果仍会保留。
                                            </p>
                                        )}
                                        {run.errorMessage && (
                                            <p className='text-wb-error mt-2 text-sm break-words'>{run.errorMessage}</p>
                                        )}
                                        {failedItems.map((item) => (
                                            <p key={item.id} className='text-wb-error mt-1 text-xs break-words'>
                                                步骤 {item.position + 1} ·{' '}
                                                {item.errorCode ? `${item.errorCode} · ` : ''}
                                                {item.errorMessage || '结果未知，等待核实。'}
                                            </p>
                                        ))}
                                        <details className='mt-2'>
                                            <summary className='text-wb-muted cursor-pointer text-xs'>查看详情</summary>
                                            <div className='text-wb-muted mt-2 space-y-2 text-xs'>
                                                <p>
                                                    {run.snapshot.params.model} · {run.snapshot.params.size} ·{' '}
                                                    {run.snapshot.params.quality} · {run.snapshot.params.imageCount} 张
                                                </p>
                                                <ul className='space-y-1'>
                                                    {run.items.map((item) => (
                                                        <li key={item.id}>
                                                            步骤 {item.position + 1} ·{' '}
                                                            {item.kind === 'image' ? '图片' : '审稿'} ·{' '}
                                                            {ITEM_LABELS[item.status] ?? item.status}
                                                            {item.estimatedCostUsd !== null
                                                                ? ` · 估算 $${item.estimatedCostUsd.toFixed(4)}`
                                                                : ''}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </details>
                                        <div className='mt-2 flex flex-wrap gap-2'>
                                            {active && (
                                                <Button
                                                    size='sm'
                                                    variant='outline'
                                                    className='h-9'
                                                    disabled={busy || localBusy || run.stopRequested}
                                                    onClick={() => {
                                                        if (
                                                            !window.confirm(
                                                                '停止后不会启动后续步骤；在途请求可能无法取消并继续计费，不承诺退款；晚到的成功结果仍会保存。继续？'
                                                            )
                                                        )
                                                            return;
                                                        void runAction('run.stop', { runId: run.id }, '已请求停止。');
                                                    }}>
                                                    {run.stopRequested ? '已请求停止' : '停止'}
                                                </Button>
                                            )}
                                            {unknown && (
                                                <Button
                                                    size='sm'
                                                    variant='outline'
                                                    className='h-9'
                                                    disabled={busy || localBusy}
                                                    onClick={() => {
                                                        if (
                                                            !window.confirm(
                                                                '确认放弃核实这些未知结果？不会自动重发，应用不会再次收费。'
                                                            )
                                                        )
                                                            return;
                                                        void runAction(
                                                            'run.abandonUnknown',
                                                            { runId: run.id },
                                                            '已放弃未知结果，继续剩余步骤。'
                                                        );
                                                    }}>
                                                    放弃未知并继续
                                                </Button>
                                            )}
                                            {run.action !== 'revise' && (
                                                <Button
                                                    size='sm'
                                                    variant='outline'
                                                    className='h-9'
                                                    disabled={busy || !canGenerate}
                                                    onClick={() => {
                                                        setRecordsOpen(false);
                                                        onOpenReroll(run.id);
                                                    }}>
                                                    按原设置再生成
                                                </Button>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={expanded} onOpenChange={setExpanded}>
                <DialogContent className='border-wb-border bg-wb-panel text-wb-ink max-h-[95dvh] overflow-y-auto sm:max-w-[92vw]'>
                    <DialogHeader>
                        <DialogTitle>原图查看 · {selected?.label}</DialogTitle>
                        <DialogDescription className='sr-only'>查看完整构图</DialogDescription>
                    </DialogHeader>
                    {selected && (
                        <div className={`flex min-h-0 items-center justify-center rounded-md ${stageClass}`}>
                            <img
                                src={`/api/workbench/assets/${selected.assetId}/file`}
                                alt={`放大作品 ${selected.label}`}
                                className='max-h-[76dvh] w-full object-contain'
                            />
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function VersionCard({
    version,
    selected,
    onSelect
}: {
    version: VersionRecord;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type='button'
            onClick={onSelect}
            aria-pressed={selected}
            aria-label={`查看 ${version.label}${version.isBaseline ? ' 基准版本' : ''}`}
            className='wb-version-card'>
            <img src={`/api/workbench/assets/${version.assetId}/file`} alt='' loading='lazy' />
            <span>{version.label}</span>
        </button>
    );
}
