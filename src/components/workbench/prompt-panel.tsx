'use client';

import { Badge, Section, useSyncedState, type PanelProps } from '@/components/workbench/shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { REFERENCE_PURPOSE_LABELS } from '@/lib/workbench/types';
import * as React from 'react';

export function PromptPanel({ detail, busy, onAction, notify }: PanelProps) {
    const prompt = detail.prompt;
    const key = `${detail.project.id}:${prompt.updatedAt}:${prompt.source}:${prompt.stale}`;
    const [text, setText] = useSyncedState(prompt.text, key);
    const [avoid, setAvoid] = useSyncedState(prompt.avoid, key);
    const [acceptance, setAcceptance] = useSyncedState(prompt.acceptance, key);
    const [localBusy, setLocalBusy] = React.useState(false);

    async function run(label: string, action: string, payload?: Record<string, unknown>) {
        setLocalBusy(true);
        try {
            await onAction(action, payload);
            notify(label);
        } finally {
            setLocalBusy(false);
        }
    }

    async function copyPrompt() {
        try {
            await navigator.clipboard.writeText(`${text}\n\n【避免项】${avoid}`);
            notify('主提示词已复制。');
        } catch {
            notify('复制失败，请手动选择文本。');
        }
    }

    return (
        <Section
            title='提示词预览与确认'
            description={
                prompt.source === 'manual'
                    ? '当前为手动修订版；设计卡或参考组变动后会标记过期。'
                    : '由设计卡、锁定项与参考用途编译；可手动修改。'
            }
            actions={
                <div className='flex flex-wrap items-center gap-1.5'>
                    {prompt.stale && <Badge tone='yellow'>已过期</Badge>}
                    <Badge tone={prompt.source === 'manual' ? 'purple' : 'blue'}>
                        {prompt.source === 'manual' ? '手动版' : '编译版'}
                    </Badge>
                    <Button size='sm' variant='outline' onClick={copyPrompt}>
                        复制
                    </Button>
                </div>
            }>
            {prompt.stale && (
                <div className='flex flex-wrap items-center justify-between gap-2 rounded border border-yellow-700/50 bg-yellow-950/20 p-2 text-[11px] text-yellow-100'>
                    <span>设计卡或参考组已变化，提示词可能不再匹配。请选择保留手动版或重新编译。</span>
                    <div className='flex gap-1.5'>
                        <Button
                            size='sm'
                            variant='outline'
                            disabled={busy || localBusy}
                            onClick={() => void run('已保留手动提示词。', 'prompt.keepManual')}>
                            保留手动版
                        </Button>
                        <Button
                            size='sm'
                            disabled={busy || localBusy}
                            onClick={() => void run('提示词已重新编译。', 'prompt.compile')}>
                            重新编译
                        </Button>
                    </div>
                </div>
            )}

            <div className='space-y-1'>
                <p className='text-[11px] font-medium text-neutral-300'>主提示词</p>
                <Textarea
                    rows={8}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    className='border-neutral-700 bg-neutral-950/60 text-xs'
                    placeholder='还没有提示词；点击“重新编译”从设计卡生成。'
                />
            </div>
            <div className='grid gap-2 md:grid-cols-2'>
                <div className='space-y-1'>
                    <p className='text-[11px] font-medium text-neutral-300'>避免项（自然语言）</p>
                    <Textarea
                        rows={4}
                        value={avoid}
                        onChange={(event) => setAvoid(event.target.value)}
                        className='border-neutral-700 bg-neutral-950/60 text-xs'
                    />
                </div>
                <div className='space-y-1'>
                    <p className='text-[11px] font-medium text-neutral-300'>验收要点</p>
                    <Textarea
                        rows={4}
                        value={acceptance}
                        onChange={(event) => setAcceptance(event.target.value)}
                        className='border-neutral-700 bg-neutral-950/60 text-xs'
                    />
                </div>
            </div>

            <div className='flex flex-wrap items-center justify-between gap-2'>
                <span className='text-[10px] text-neutral-500'>
                    设计 v{prompt.designVersion} · 参考组哈希 {prompt.bindingHash.slice(0, 10) || '—'}
                </span>
                <div className='flex gap-1.5'>
                    <Button
                        size='sm'
                        variant='outline'
                        disabled={busy || localBusy}
                        onClick={() => void run('提示词已重新编译。', 'prompt.compile')}>
                        重新编译（免费）
                    </Button>
                    <Button
                        size='sm'
                        disabled={busy || localBusy || !text.trim()}
                        onClick={() =>
                            void run('手动提示词已保存为修订版。', 'prompt.saveManual', { text, avoid, acceptance })
                        }>
                        保存为手动修订
                    </Button>
                </div>
            </div>

            <div className='rounded border border-neutral-800 bg-neutral-950/40 p-2'>
                <p className='text-[11px] font-medium text-neutral-300'>本次实际参考顺序（会随快照发送给生图与审稿）</p>
                {detail.references.length === 0 ? (
                    <p className='mt-1 text-[11px] text-neutral-500'>暂无参考图。</p>
                ) : (
                    <ol className='mt-1 space-y-1 text-[11px] text-neutral-400'>
                        {[...detail.references]
                            .sort((a, b) => a.position - b.position)
                            .map((binding, index) => (
                                <li key={binding.id}>
                                    {index + 1}. {binding.asset.originalName} · {REFERENCE_PURPOSE_LABELS[binding.purpose]}
                                    {binding.borrow ? ` · 借用：${binding.borrow}` : ''}
                                    {binding.exclude ? ` · 不借用：${binding.exclude}` : ''}
                                </li>
                            ))}
                    </ol>
                )}
            </div>
        </Section>
    );
}
