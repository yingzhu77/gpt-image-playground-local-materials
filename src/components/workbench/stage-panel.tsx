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
    onOpenRevision: (versionId: string, suggestions?: { change: string; keep: string }[]) => void;
    onOpenReroll: (runId: string) => void;
};

const ACTION_LABELS = { generate: '生成', revise: '修订', reroll: '再抽' };
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
    busy,
    selectedVersionId,
    onSelectVersion,
    onAction,
    onOpenGenerate,
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
    const [expanded, setExpanded] = React.useState(false);
    const [backdrop, setBackdrop] = React.useState<'dark' | 'light' | 'checker'>('dark');
    const [localBusy, setLocalBusy] = React.useState(false);
    const latestRun = detail.runs[0] ?? null;
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
            <Section
                title='创作舞台'
                description={
                    selected
                        ? `${selected.label} · ${ACTION_LABELS[selected.runAction]} · ${selected.asset.width} × ${selected.asset.height}`
                        : '作品保留完整构图，生成前先确认已保存的方案。'
                }
                actions={
                    <div className='flex flex-wrap items-center gap-2'>
                        <label className='text-wb-muted flex items-center gap-2 text-xs'>
                            舞台
                            <select
                                aria-label='舞台背景'
                                value={backdrop}
                                onChange={(event) => setBackdrop(event.target.value as typeof backdrop)}
                                className='border-wb-border bg-wb-panel text-wb-ink h-9 rounded-md border px-2'>
                                <option value='dark'>深灰</option>
                                <option value='light'>浅灰</option>
                                <option value='checker'>透明棋盘格</option>
                            </select>
                        </label>
                        {selected && (
                            <Button
                                size='sm'
                                variant='outline'
                                className='h-9'
                                onClick={() => setExpanded(true)}
                                title='完整查看当前作品'>
                                <Expand className='size-4' aria-hidden='true' />
                                放大查看
                            </Button>
                        )}
                    </div>
                }>
                {selected ? (
                    <div
                        className={`border-wb-border flex min-h-[280px] items-center justify-center overflow-hidden rounded-md border ${stageClass}`}>
                        <img
                            src={`/api/workbench/assets/${selected.assetId}/file`}
                            alt={`当前作品 ${selected.label}`}
                            className='max-h-[58vh] min-h-0 w-full object-contain'
                        />
                    </div>
                ) : (
                    <div className='bg-wb-stage text-wb-stage-ink flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-md p-6 text-center'>
                        <ImageIcon className='size-8' aria-hidden='true' />
                        <p className='text-base font-medium'>还没有结果</p>
                        <p className='max-w-md text-sm leading-relaxed'>
                            先整理设计卡、保存参考组并确认提示词。生成前可以核对模型、参考顺序与费用。
                        </p>
                    </div>
                )}

                <div className='flex flex-wrap items-center gap-2'>
                    <Button size='sm' className='h-9' disabled={busy} onClick={onOpenGenerate}>
                        生成 1/2 张
                    </Button>
                    {selected && (
                        <Button
                            size='sm'
                            variant='outline'
                            className='h-9'
                            disabled={busy}
                            onClick={() => onOpenRevision(selected.id)}>
                            修一版
                        </Button>
                    )}
                    {latestRun && (
                        <Button
                            size='sm'
                            variant='outline'
                            className='h-9'
                            disabled={busy}
                            onClick={() => onOpenReroll(latestRun.id)}>
                            同方案再抽
                        </Button>
                    )}
                    {selected && (
                        <>
                            <Button
                                size='sm'
                                variant='outline'
                                className='h-9'
                                disabled={busy || localBusy || selected.isBaseline}
                                onClick={() =>
                                    void runAction(
                                        'version.baseline',
                                        { versionId: selected.id },
                                        `已把 ${selected.label} 设为基准。`
                                    )
                                }>
                                {selected.isBaseline ? '当前基准' : '设为基准'}
                            </Button>
                            <a
                                href={`/api/workbench/versions/${selected.id}/download`}
                                className='border-wb-border text-wb-ink hover:bg-wb-subtle inline-flex h-9 items-center rounded-md border px-3 text-sm'>
                                下载原图
                            </a>
                            <a
                                href={`/api/workbench/versions/${selected.id}/download?format=info`}
                                className='border-wb-border text-wb-ink hover:bg-wb-subtle inline-flex h-9 items-center rounded-md border px-3 text-sm'>
                                下载信息记录
                            </a>
                            {versions.length >= 2 && (
                                <Button
                                    size='sm'
                                    variant='outline'
                                    className='h-9'
                                    aria-expanded={comparing}
                                    onClick={() => {
                                        if (!comparing) {
                                            setCompareA(selected.id);
                                            setCompareB(
                                                (selected.isBaseline
                                                    ? versions.find((version) => version.id !== selected.id)?.id
                                                    : detail.project.baselineVersionId) ||
                                                    versions.find((version) => version.id !== selected.id)?.id ||
                                                    ''
                                            );
                                        }
                                        setComparing(!comparing);
                                    }}>
                                    {comparing ? '收起对比' : '放入对比'}
                                </Button>
                            )}
                        </>
                    )}
                </div>
                {selected && (
                    <p className='text-wb-muted text-xs'>
                        原图 {selected.asset.width} × {selected.asset.height} · {formatTime(selected.createdAt)} ·
                        SHA-256 {selected.asset.sha256.slice(0, 12)}
                    </p>
                )}

                {versions.length > 0 && (
                    <div>
                        <div className='text-wb-muted mb-2 flex items-center justify-between text-xs'>
                            <span>版本记录</span>
                            <span>{versions.length} 个真实版本 · 查看不创建任务</span>
                        </div>
                        <div className='flex gap-2 overflow-x-auto pb-2' aria-label='版本记录'>
                            {versions.map((version) => (
                                <VersionCard
                                    key={version.id}
                                    version={version}
                                    selected={selected?.id === version.id}
                                    parentLabel={
                                        versions.find((parent) => parent.id === version.parentVersionId)?.label
                                    }
                                    onSelect={() => onSelectVersion(version.id)}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </Section>

            {versions.length >= 2 && comparing && (
                <Section
                    title='并排对比'
                    description='两个画面使用相同展示比例，完整显示边缘；查看不调用模型。'
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
                                            (version.reviewStatus === 'pending' ? '审稿尚未完成' : '审稿暂不可用')}
                                    </p>
                                </figure>
                            ) : null
                        )}
                    </div>
                </Section>
            )}

            <Section title='任务状态与历史' description='状态保存在服务端；刷新不会重发已完成步骤。'>
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
                                                          (item) => item.status === 'sending' && item.kind === 'review'
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
                                            步骤 {item.position + 1} · {item.errorCode ? `${item.errorCode} · ` : ''}
                                            {item.errorMessage || '结果未知，等待核实。'}
                                        </p>
                                    ))}
                                    <details className='mt-2'>
                                        <summary className='text-wb-muted cursor-pointer text-xs'>
                                            查看运行详情与步骤
                                        </summary>
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
                                                disabled={busy}
                                                onClick={() => onOpenReroll(run.id)}>
                                                同方案再抽
                                            </Button>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Section>

            <Dialog open={expanded} onOpenChange={setExpanded}>
                <DialogContent className='border-wb-border bg-wb-panel text-wb-ink max-h-[95dvh] overflow-y-auto sm:max-w-[92vw]'>
                    <DialogHeader>
                        <DialogTitle>原图查看 · {selected?.label}</DialogTitle>
                        <DialogDescription>完整构图 · 仅改变预览背景，不修改原图字节。</DialogDescription>
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
    parentLabel,
    onSelect
}: {
    version: VersionRecord;
    selected: boolean;
    parentLabel?: string;
    onSelect: () => void;
}) {
    return (
        <button
            type='button'
            onClick={onSelect}
            aria-pressed={selected}
            aria-label={`查看 ${version.label}${version.isBaseline ? ' 基准版本' : ''}`}
            className={`w-40 shrink-0 overflow-hidden rounded-md border text-left transition-colors ${selected ? 'border-wb-accent bg-wb-accent-soft' : 'border-wb-border bg-wb-panel hover:border-wb-accent'}`}>
            <img
                src={`/api/workbench/assets/${version.assetId}/file`}
                alt={version.label}
                className='bg-wb-stage aspect-video w-full object-cover'
            />
            <div className='space-y-1 p-2'>
                <div className='flex flex-wrap items-center gap-1'>
                    <span className='text-wb-ink text-sm font-semibold'>{version.label}</span>
                    {version.isBaseline && <Badge tone='green'>基准</Badge>}
                </div>
                <p className='text-wb-muted text-xs'>
                    {ACTION_LABELS[version.runAction]}
                    {parentLabel ? ` · 来自 ${parentLabel}` : ''}
                </p>
                {version.reviewStatus === 'available' && (
                    <p className={`text-xs ${version.review?.acceptable ? 'text-wb-success' : 'text-wb-warning'}`}>
                        {version.review?.acceptable ? '审稿可接受' : '建议修订'}
                    </p>
                )}
                {version.reviewStatus === 'pending' && <p className='text-wb-info text-xs'>审稿中</p>}
                {version.reviewStatus === 'unavailable' && <p className='text-wb-warning text-xs'>审稿暂不可用</p>}
            </div>
        </button>
    );
}
