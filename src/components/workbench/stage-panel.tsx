'use client';

import { Badge, RunStatusBadge, Section, type PanelProps } from '@/components/workbench/shared';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatTime } from '@/lib/workbench/client';
import type { VersionRecord } from '@/lib/workbench/types';
import * as React from 'react';

type StageProps = PanelProps & {
    onOpenGenerate: () => void;
    onOpenRevision: (versionId: string, suggestions?: { change: string; keep: string }[]) => void;
    onOpenReroll: (runId: string) => void;
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
    notify
}: StageProps) {
    const versions = detail.versions;
    const selected = versions.find((version) => version.id === selectedVersionId) ?? versions[versions.length - 1] ?? null;
    const [compareA, setCompareA] = React.useState<string>('');
    const [compareB, setCompareB] = React.useState<string>('');
    const [localBusy, setLocalBusy] = React.useState(false);
    const latestRun = detail.runs[0] ?? null;

    const defaultA = versions[0]?.id ?? '';
    const defaultB = versions[1]?.id ?? selected?.id ?? versions[0]?.id ?? '';
    const versionA = versions.find((version) => version.id === (compareA || defaultA)) ?? null;
    const versionB = versions.find((version) => version.id === (compareB || defaultB)) ?? null;

    async function runAction(action: string, payload: Record<string, unknown>, message: string) {
        setLocalBusy(true);
        try {
            await onAction(action, payload);
            notify(message);
        } finally {
            setLocalBusy(false);
        }
    }

    return (
        <div className='space-y-3'>
            <Section
                title='创作舞台'
                description='同一方案 1–2 张独立结果；审稿后人工选择基准。'
                actions={
                    <div className='flex flex-wrap gap-1.5'>
                        <Button size='sm' disabled={busy} onClick={onOpenGenerate}>
                            生成 1/2 张
                        </Button>
                        {selected && (
                            <Button size='sm' variant='outline' disabled={busy} onClick={() => onOpenRevision(selected.id)}>
                                修一版
                            </Button>
                        )}
                        {latestRun && (
                            <Button size='sm' variant='outline' disabled={busy} onClick={() => onOpenReroll(latestRun.id)}>
                                同方案再抽
                            </Button>
                        )}
                    </div>
                }>
                {versions.length === 0 ? (
                    <div className='flex min-h-[320px] flex-col items-center justify-center gap-2 rounded border border-dashed border-neutral-700 bg-neutral-950/40 p-6 text-center'>
                        <p className='text-sm text-neutral-300'>还没有结果</p>
                        <p className='max-w-md text-[11px] text-neutral-500'>
                            先整理设计卡、保存参考组并确认提示词，然后点击“生成 1/2 张”。确认后会保存不可变快照，再开始付费调用。
                        </p>
                        <Button size='sm' disabled={busy} onClick={onOpenGenerate}>
                            准备生成
                        </Button>
                    </div>
                ) : (
                    <div className='grid gap-2 sm:grid-cols-2'>
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

                {selected && (
                    <div className='flex flex-wrap items-center gap-1.5 rounded border border-neutral-800 bg-neutral-950/40 p-2'>
                        <Badge tone='blue'>当前 {selected.label}</Badge>
                        <Button
                            size='sm'
                            variant='outline'
                            disabled={busy || localBusy}
                            onClick={() => void runAction('version.baseline', { versionId: selected.id }, `已把 ${selected.label} 设为基准。`)}>
                            设为基准
                        </Button>
                        <a
                            href={`/api/workbench/versions/${selected.id}/download`}
                            className='inline-flex h-8 items-center rounded-md border border-neutral-600 px-3 text-xs text-neutral-200 hover:bg-neutral-800'>
                            下载原图
                        </a>
                        <a
                            href={`/api/workbench/versions/${selected.id}/download?format=info`}
                            className='inline-flex h-8 items-center rounded-md border border-neutral-600 px-3 text-xs text-neutral-200 hover:bg-neutral-800'>
                            下载信息记录
                        </a>
                        <Button size='sm' variant='outline' disabled={busy} onClick={() => onOpenRevision(selected.id)}>
                            以 {selected.label} 为修订基底
                        </Button>
                        <Button
                            size='sm'
                            variant='outline'
                            disabled={busy}
                            onClick={() => {
                                setCompareA(selected.id);
                                setCompareB(
                                    selected.isBaseline
                                        ? (versions.find((version) => version.id !== selected.id)?.id ?? '')
                                        : (detail.project.baselineVersionId ?? '')
                                );
                            }}>
                            放入对比
                        </Button>
                        <span className='text-[10px] text-neutral-500'>
                            {selected.asset.width}×{selected.asset.height} · {selected.asset.sha256.slice(0, 12)} · {formatTime(selected.createdAt)}
                        </span>
                    </div>
                )}
            </Section>

            {versions.length >= 2 && (
                <Section
                    title='并排对比'
                    description='默认选择两个版本；对比不调用模型。'
                    actions={
                        <div className='flex gap-1.5'>
                            <Select value={compareA || defaultA} onValueChange={setCompareA}>
                                <SelectTrigger className='h-7 w-24 border-neutral-700 bg-neutral-950 text-[11px]'>
                                    <SelectValue placeholder='左' />
                                </SelectTrigger>
                                <SelectContent>
                                    {versions.map((version) => (
                                        <SelectItem key={version.id} value={version.id}>{version.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={compareB || defaultB} onValueChange={setCompareB}>
                                <SelectTrigger className='h-7 w-24 border-neutral-700 bg-neutral-950 text-[11px]'>
                                    <SelectValue placeholder='右' />
                                </SelectTrigger>
                                <SelectContent>
                                    {versions.map((version) => (
                                        <SelectItem key={version.id} value={version.id}>{version.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    }>
                    <div className='grid gap-2 md:grid-cols-2'>
                        {[versionA, versionB].map((version, index) =>
                            version ? (
                                <div key={`${version.id}-${index}`} className='space-y-1'>
                                    <div className='flex items-center justify-between text-[11px]'>
                                        <span className='font-medium text-neutral-200'>
                                            {version.label} {version.isBaseline ? '· 基准' : ''}
                                        </span>
                                        <span className='text-neutral-500'>{version.asset.width}×{version.asset.height}</span>
                                    </div>
                                    <img
                                        src={`/api/workbench/assets/${version.assetId}/file`}
                                        alt={version.label}
                                        className='w-full rounded border border-neutral-800 object-contain'
                                    />
                                    <p className='line-clamp-3 text-[10px] text-neutral-400'>
                                        {version.review?.summary ?? '审稿待生成'}
                                    </p>
                                </div>
                            ) : null
                        )}
                    </div>
                </Section>
            )}

            <Section title='任务状态与历史' description='状态持久化在服务端；刷新或关闭页面不会重发已完成步骤。'>
                {detail.runs.length === 0 ? (
                    <p className='text-[11px] text-neutral-500'>还没有运行记录。</p>
                ) : (
                    <ul className='space-y-2'>
                        {detail.runs.map((run) => {
                            const successImages = run.items.filter((item) => item.kind === 'image' && item.status === 'success').length;
                            const failedImages = run.items.filter((item) => item.kind === 'image' && (item.status === 'failed' || item.status === 'skipped')).length;
                            const unknown = run.items.some((item) => item.status === 'unknown');
                            return (
                                <li key={run.id} className='rounded border border-neutral-800 bg-neutral-950/40 p-2'>
                                    <div className='flex flex-wrap items-center gap-2 text-[11px]'>
                                        <RunStatusBadge status={run.status} />
                                        <Badge>{run.action === 'generate' ? '生成' : run.action === 'revise' ? '修订' : '再抽'}</Badge>
                                        <span className='text-neutral-300'>{run.snapshot.params.model} · {run.snapshot.params.size} · {run.snapshot.params.quality} · {run.snapshot.params.imageCount} 张</span>
                                        <span className='text-neutral-500'>{formatTime(run.createdAt)}</span>
                                        <span className='text-neutral-500'>成功 {successImages} / 失败或跳过 {failedImages}</span>
                                    </div>
                                    <details className='mt-1'>
                                        <summary className='cursor-pointer text-[10px] text-neutral-400'>查看步骤与错误</summary>
                                        <ul className='mt-1 space-y-1 text-[10px] text-neutral-400'>
                                            {run.items.map((item) => (
                                                <li key={item.id}>
                                                    #{item.position + 1} {item.kind === 'image' ? '图片' : '审稿'} · {item.status}
                                                    {item.errorCode ? ` · ${item.errorCode}` : ''}
                                                    {item.estimatedCostUsd !== null ? ` · 估算 $${item.estimatedCostUsd.toFixed(4)}` : ''}
                                                    {item.errorMessage ? <span className='block text-neutral-500'>{item.errorMessage}</span> : null}
                                                </li>
                                            ))}
                                        </ul>
                                    </details>
                                    <div className='mt-1 flex flex-wrap gap-1.5'>
                                        {['queued', 'running'].includes(run.status) && (
                                            <Button
                                                size='sm'
                                                variant='outline'
                                                className='h-6 px-2 text-[10px]'
                                                disabled={busy || localBusy}
                                                onClick={() => {
                                                    if (!window.confirm('停止后不会启动后续步骤；在途请求可能无法取消并继续计费，不承诺退款；晚到的成功结果仍会保存。继续？')) return;
                                                    void runAction('run.stop', { runId: run.id }, '已请求停止。');
                                                }}>
                                                停止
                                            </Button>
                                        )}
                                        {unknown && (
                                            <Button
                                                size='sm'
                                                variant='outline'
                                                className='h-6 px-2 text-[10px]'
                                                disabled={busy || localBusy}
                                                onClick={() => {
                                                    if (!window.confirm('确认放弃核实这些未知结果？不会自动重发，应用不会再次收费。')) return;
                                                    void runAction('run.abandonUnknown', { runId: run.id }, '已放弃未知结果，继续剩余步骤。');
                                                }}>
                                                放弃未知并继续
                                            </Button>
                                        )}
                                        {run.action !== 'revise' && (
                                            <Button
                                                size='sm'
                                                variant='outline'
                                                className='h-6 px-2 text-[10px]'
                                                disabled={busy}
                                                onClick={() => onOpenReroll(run.id)}>
                                                同方案再抽
                                            </Button>
                                        )}
                                    </div>
                                    {run.errorMessage && <p className='mt-1 text-[10px] text-yellow-200/80'>{run.errorMessage}</p>}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Section>
        </div>
    );
}

function VersionCard({ version, selected, onSelect }: { version: VersionRecord; selected: boolean; onSelect: () => void }) {
    return (
        <button
            type='button'
            onClick={onSelect}
            className={`group overflow-hidden rounded border text-left transition ${
                selected ? 'border-amber-500 ring-1 ring-amber-500/40' : 'border-neutral-800 hover:border-neutral-600'
            }`}>
            <img
                src={`/api/workbench/assets/${version.assetId}/file`}
                alt={version.label}
                className='aspect-video w-full bg-neutral-950 object-contain'
            />
            <div className='flex flex-wrap items-center gap-1 bg-neutral-950/60 px-2 py-1.5'>
                <span className='text-xs font-semibold text-neutral-100'>{version.label}</span>
                {version.isBaseline && <Badge tone='green'>基准</Badge>}
                {version.reviewStatus === 'available' && version.review?.acceptable && <Badge tone='green'>审稿可接受</Badge>}
                {version.reviewStatus === 'pending' && <Badge tone='blue'>审稿中</Badge>}
                {version.reviewStatus === 'unavailable' && <Badge tone='yellow'>审稿暂不可用</Badge>}
                <span className='text-[10px] text-neutral-500'>{version.asset.width}×{version.asset.height}</span>
            </div>
        </button>
    );
}
