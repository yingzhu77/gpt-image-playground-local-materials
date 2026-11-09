'use client';

import { FieldLabel, Section, useSyncedState, type PanelProps } from '@/components/workbench/shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { DesignCard, DesignFieldKey, DesignUpdateResult } from '@/lib/workbench/types';
import { DESIGN_FIELD_LABELS } from '@/lib/workbench/types';
import * as React from 'react';

const TEXT_FIELDS: { key: DesignFieldKey; rows: number; hint?: string }[] = [
    { key: 'subject', rows: 2 },
    { key: 'subjectVersion', rows: 2 },
    { key: 'sceneIntent', rows: 3 },
    { key: 'composition', rows: 3 },
    { key: 'actionView', rows: 2 },
    { key: 'colorLight', rows: 2 },
    { key: 'artStyle', rows: 3 },
    { key: 'aspectRatio', rows: 1, hint: '例如 16:9' }
];

export function DesignPanel({ detail, status, busy, plannerModel, plannerEffort, onAction, requestPaid }: PanelProps) {
    const syncKey = `${detail.project.id}:${detail.project.designVersion}`;
    const [card, setCard] = useSyncedState<DesignCard>(detail.design, syncKey);
    const [locks, setLocks] = useSyncedState<DesignFieldKey[]>(detail.lockedFields, syncKey);
    const [instruction, setInstruction] = React.useState('');
    const [lastResult, setLastResult] = React.useState<DesignUpdateResult | null>(null);
    const [localBusy, setLocalBusy] = React.useState(false);

    const locked = new Set(locks);

    function updateField(field: DesignFieldKey, value: string | string[]) {
        setCard((current) => ({ ...current, [field]: value }));
    }

    function toggleLock(field: DesignFieldKey) {
        setLocks((current) => (current.includes(field) ? current.filter((item) => item !== field) : [...current, field]));
    }

    async function saveCard() {
        setLocalBusy(true);
        try {
            await onAction('design.save', { card, lockedFields: locks });
        } finally {
            setLocalBusy(false);
        }
    }

    function applyInstruction() {
        if (!instruction.trim()) return;
        requestPaid({
            title: '用自然语言修改设计卡',
            description: '工作台会把当前设计卡、锁定项与参考用途发送给规划模型，只调整相关字段。锁定字段不会被改写。',
            lines: [
                `规划模型：${plannerModel} · 思考强度：${plannerEffort}`,
                '规划调用：1 次',
                '费用：未知（文本模型价格未配置）',
                '不会生图、不会搜索、不会改动已确认参考用途'
            ],
            confirmLabel: '确认修改（1 次规划调用）',
            onConfirm: async () => {
                const response = await onAction('design.update', {
                    instruction: instruction.trim(),
                    confirmPlanner: true,
                    plannerModel,
                    reasoningEffort: plannerEffort
                });
                const result = response?.result as DesignUpdateResult | undefined;
                if (result) setLastResult(result);
                setInstruction('');
            }
        });
    }

    async function unlockAndApply(field: DesignFieldKey, proposed: string) {
        const nextCard = { ...card, [field]: proposed } as DesignCard;
        const nextLocks = locks.filter((item) => item !== field);
        setCard(nextCard);
        setLocks(nextLocks);
        await onAction('design.unlock', { fields: [field] });
        await onAction('design.save', { card: nextCard, lockedFields: nextLocks });
        setLastResult(null);
    }

    return (
        <div className='space-y-3'>
            <Section
                title='设计卡'
                description={`正式创作状态 · v${detail.project.designVersion} · 锁定 ${locks.length} 项`}
                actions={
                    <Button size='sm' variant='outline' disabled={busy || localBusy} onClick={saveCard}>
                        保存设计卡（免费）
                    </Button>
                }>
                <div className='space-y-2.5'>
                    {TEXT_FIELDS.map((entry) => (
                        <div key={entry.key} className='space-y-1'>
                            <div className='flex items-center justify-between gap-2'>
                                <FieldLabel hint={entry.hint}>{DESIGN_FIELD_LABELS[entry.key]}</FieldLabel>
                                <label className='flex items-center gap-1 text-[10px] text-neutral-400'>
                                    <input
                                        type='checkbox'
                                        className='size-3 accent-amber-500'
                                        checked={locked.has(entry.key)}
                                        onChange={() => toggleLock(entry.key)}
                                    />
                                    锁定
                                </label>
                            </div>
                            <Textarea
                                rows={entry.rows}
                                value={String(card[entry.key] ?? '')}
                                onChange={(event) => updateField(entry.key, event.target.value)}
                                className='border-neutral-700 bg-neutral-950/60 text-xs'
                            />
                        </div>
                    ))}

                    {(['mustKeep', 'mayChange'] as const).map((key) => (
                        <div key={key} className='space-y-1'>
                            <div className='flex items-center justify-between gap-2'>
                                <FieldLabel hint='每行一项'>{DESIGN_FIELD_LABELS[key]}</FieldLabel>
                                <label className='flex items-center gap-1 text-[10px] text-neutral-400'>
                                    <input
                                        type='checkbox'
                                        className='size-3 accent-amber-500'
                                        checked={locked.has(key)}
                                        onChange={() => toggleLock(key)}
                                    />
                                    锁定
                                </label>
                            </div>
                            <Textarea
                                rows={3}
                                value={card[key].join('\n')}
                                onChange={(event) =>
                                    updateField(
                                        key,
                                        event.target.value
                                            .split('\n')
                                            .map((line) => line.trim())
                                            .filter(Boolean)
                                    )
                                }
                                className='border-neutral-700 bg-neutral-950/60 text-xs'
                            />
                        </div>
                    ))}
                </div>

                {card.assumptions.length > 0 && (
                    <div className='rounded border border-neutral-800 bg-neutral-950/40 p-2'>
                        <p className='text-[11px] font-medium text-neutral-300'>待确认假设</p>
                        <ul className='mt-1 space-y-1 text-[11px] text-neutral-400'>
                            {card.assumptions.map((item, index) => (
                                <li key={`${item.field}-${index}`}>
                                    <span className='text-neutral-300'>{item.field}</span>：{item.value}
                                    <span className='text-neutral-500'>（{item.reason}）</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {card.missingReferences.length > 0 && (
                    <div className='rounded border border-yellow-700/40 bg-yellow-950/20 p-2 text-[11px] text-yellow-200'>
                        缺失参考：{card.missingReferences.join('、')}
                    </div>
                )}
            </Section>

            <Section
                title='自然语言修改'
                description='只调整相关字段；不自动重新搜索、重新生图或改掉已确认的参考用途。'>
                <Textarea
                    rows={2}
                    placeholder='例如：人物稍微大一点，服装和场景核心关系保持'
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    className='border-neutral-700 bg-neutral-950/60 text-xs'
                />
                <div className='flex items-center justify-between gap-2'>
                    <span className='text-[10px] text-neutral-500'>
                        {status.mock
                            ? `Mock 模式：本地夹具规划（${plannerModel} · ${plannerEffort}）`
                            : `${plannerModel} · 思考强度 ${plannerEffort} · 1 次规划调用 · 费用未知`}
                    </span>
                    <Button size='sm' disabled={busy || localBusy || !instruction.trim()} onClick={applyInstruction}>
                        应用修改
                    </Button>
                </div>

                {lastResult && (
                    <div className='space-y-2'>
                        {lastResult.changeSummary.length > 0 && (
                            <div className='rounded border border-green-700/40 bg-green-950/20 p-2'>
                                <p className='text-[11px] font-medium text-green-300'>本次变化</p>
                                <ul className='mt-1 space-y-1 text-[11px] text-green-100/80'>
                                    {lastResult.changeSummary.map((change) => (
                                        <li key={change.field}>
                                            <span className='font-medium'>{DESIGN_FIELD_LABELS[change.field]}</span>：{change.before || '（空）'} → {change.after || '（空）'}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {lastResult.conflicts.length > 0 && (
                            <div className='rounded border border-yellow-700/50 bg-yellow-950/20 p-2'>
                                <p className='text-[11px] font-medium text-yellow-200'>锁定冲突（未自动应用）</p>
                                <ul className='mt-1 space-y-2 text-[11px] text-yellow-100/80'>
                                    {lastResult.conflicts.map((conflict) => (
                                        <li key={conflict.field} className='space-y-1'>
                                            <div>
                                                <span className='font-medium'>{DESIGN_FIELD_LABELS[conflict.field]}</span>：{conflict.proposed}
                                            </div>
                                            <div className='flex items-center justify-between gap-2'>
                                                <span className='text-yellow-200/60'>{conflict.reason}</span>
                                                <Button
                                                    size='sm'
                                                    variant='outline'
                                                    className='h-6 border-yellow-600/50 text-[10px] text-yellow-100'
                                                    disabled={busy}
                                                    onClick={() => void unlockAndApply(conflict.field, conflict.proposed)}>
                                                    解锁并应用此变更
                                                </Button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {lastResult.changeSummary.length === 0 && lastResult.conflicts.length === 0 && (
                            <p className='text-[11px] text-neutral-400'>模型没有提出有效变化。</p>
                        )}
                    </div>
                )}
            </Section>
        </div>
    );
}
