'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge, Section, useDraftStatus, useSyncedState, type PanelProps } from '@/components/workbench/shared';
import { REFERENCE_PURPOSE_LABELS } from '@/lib/workbench/types';
import * as React from 'react';

export function PromptPanel({ detail, busy, onAction, notify, setError }: PanelProps) {
    const prompt = detail.prompt;
    const key = `${detail.project.id}:${prompt.updatedAt}:${prompt.source}:${prompt.stale}`;
    const [text, setText] = useSyncedState(prompt.text, key);
    const [avoid, setAvoid] = useSyncedState(prompt.avoid, key);
    const [acceptance, setAcceptance] = useSyncedState(prompt.acceptance, key);
    const [localBusy, setLocalBusy] = React.useState(false);
    const dirty = text !== prompt.text || avoid !== prompt.avoid || acceptance !== prompt.acceptance;
    useDraftStatus(`prompt:${detail.project.id}`, dirty);

    async function run(label: string, action: string, payload?: Record<string, unknown>) {
        if (
            action === 'prompt.compile' &&
            dirty &&
            !window.confirm('更新提示词会替换当前未保存的主提示词、避免项与验收要点。放弃这些草稿并继续？')
        )
            return;
        setLocalBusy(true);
        try {
            const response = await onAction(action, payload);
            const saved = (response?.project as PanelProps['detail'] | undefined)?.prompt;
            if (saved) {
                setText(saved.text);
                setAvoid(saved.avoid);
                setAcceptance(saved.acceptance);
            }
            notify(label);
        } catch (error) {
            setError(error instanceof Error ? error.message : '提示词操作失败，草稿已保留。');
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
            title='提示词'
            actions={
                <div className='flex flex-wrap items-center gap-1.5'>
                    {dirty && <Badge tone='yellow'>未保存</Badge>}
                    <Button size='sm' variant='outline' onClick={copyPrompt}>
                        复制
                    </Button>
                </div>
            }>
            {prompt.stale && (
                <div className='border-wb-warning bg-wb-warning-soft text-wb-warning flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-[13px]'>
                    <span>方案或参考图已变更，请确认提示词。</span>
                    <div className='flex gap-1.5'>
                        {!!prompt.text.trim() && (
                            <Button
                                size='sm'
                                variant='outline'
                                disabled={busy || localBusy || dirty}
                                onClick={() => void run('已保留手动提示词。', 'prompt.keepManual')}>
                                保留当前提示词
                            </Button>
                        )}
                        <Button
                            size='sm'
                            disabled={busy || localBusy}
                            onClick={() => void run('提示词已更新提示词。', 'prompt.compile')}>
                            更新提示词
                        </Button>
                    </div>
                </div>
            )}

            <div className='space-y-1'>
                <label htmlFor={`prompt-main-${detail.project.id}`} className='text-wb-ink text-[13px] font-medium'>
                    画面描述
                </label>
                <Textarea
                    disabled={busy || localBusy}
                    id={`prompt-main-${detail.project.id}`}
                    rows={8}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    className='border-wb-border bg-wb-panel text-sm leading-relaxed'
                    placeholder='还没有提示词。可从方案生成，也可自己填写。'
                />
            </div>
            <details className='border-wb-border rounded-md border p-3'>
                <summary className='text-wb-accent cursor-pointer text-sm'>避免内容与检查要点</summary>
                <div className='mt-3 grid gap-3 md:grid-cols-2'>
                    <div className='space-y-1'>
                        <label
                            htmlFor={`prompt-avoid-${detail.project.id}`}
                            className='text-wb-ink text-[13px] font-medium'>
                            避免项（自然语言）
                        </label>
                        <Textarea
                            disabled={busy || localBusy}
                            id={`prompt-avoid-${detail.project.id}`}
                            rows={4}
                            value={avoid}
                            onChange={(event) => setAvoid(event.target.value)}
                            className='border-wb-border bg-wb-panel text-sm leading-relaxed'
                        />
                    </div>
                    <div className='space-y-1'>
                        <label
                            htmlFor={`prompt-acceptance-${detail.project.id}`}
                            className='text-wb-ink text-[13px] font-medium'>
                            验收要点
                        </label>
                        <Textarea
                            disabled={busy || localBusy}
                            id={`prompt-acceptance-${detail.project.id}`}
                            rows={4}
                            value={acceptance}
                            onChange={(event) => setAcceptance(event.target.value)}
                            className='border-wb-border bg-wb-panel text-sm leading-relaxed'
                        />
                    </div>
                </div>
            </details>

            <div className='flex flex-wrap justify-end gap-2'>
                {!prompt.stale && (
                    <Button
                        size='sm'
                        variant='outline'
                        disabled={busy || localBusy}
                        onClick={() => void run('提示词已更新提示词。', 'prompt.compile')}>
                        从方案更新（免费）
                    </Button>
                )}
                <Button
                    size='sm'
                    disabled={busy || localBusy || !text.trim() || !dirty}
                    onClick={() =>
                        void run('手动提示词已保存为修订版。', 'prompt.saveManual', { text, avoid, acceptance })
                    }>
                    保存提示词
                </Button>
            </div>

            <details className='border-wb-border bg-wb-panel rounded-md border p-3'>
                <summary className='text-wb-accent cursor-pointer text-sm'>参考图顺序</summary>
                {detail.references.length === 0 ? (
                    <p className='text-wb-muted mt-1 text-[13px]'>暂无参考图。</p>
                ) : (
                    <ol className='text-wb-muted mt-1 space-y-1 text-[13px]'>
                        {[...detail.references]
                            .sort((a, b) => a.position - b.position)
                            .map((binding, index) => (
                                <li key={binding.id}>
                                    {index + 1}. {binding.asset.originalName} ·{' '}
                                    {REFERENCE_PURPOSE_LABELS[binding.purpose]}
                                    {binding.borrow ? ` · 借用：${binding.borrow}` : ''}
                                    {binding.exclude ? ` · 不借用：${binding.exclude}` : ''}
                                </li>
                            ))}
                    </ol>
                )}
            </details>
        </Section>
    );
}
