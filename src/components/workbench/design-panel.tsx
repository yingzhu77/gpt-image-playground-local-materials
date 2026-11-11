'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
    Badge,
    FieldLabel,
    Section,
    useDraftStatus,
    useSyncedState,
    type PanelProps
} from '@/components/workbench/shared';
import { isDesignFieldKey } from '@/lib/workbench/schema';
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

function isCoreField(key: DesignFieldKey) {
    return key === 'subject' || key === 'sceneIntent';
}

export function DesignPanel({
    detail,
    busy,
    plannerModel,
    plannerEffort,
    onAction,
    requestPaid,
    setError
}: PanelProps) {
    const syncKey = `${detail.project.id}:${detail.project.designVersion}`;
    const [card, setCard] = useSyncedState<DesignCard>(detail.design, syncKey);
    const [locks, setLocks] = useSyncedState<DesignFieldKey[]>(detail.lockedFields, syncKey);
    const [instruction, setInstruction] = React.useState('');
    const [lastResult, setLastResult] = React.useState<DesignUpdateResult | null>(null);
    const [localBusy, setLocalBusy] = React.useState(false);
    const dirty =
        JSON.stringify(card) !== JSON.stringify(detail.design) ||
        JSON.stringify(locks) !== JSON.stringify(detail.lockedFields);
    useDraftStatus(`design:${detail.project.id}`, dirty);

    const locked = new Set(locks);

    function updateField(field: DesignFieldKey, value: string | string[]) {
        setCard((current) => ({ ...current, [field]: value }));
    }

    function toggleLock(field: DesignFieldKey) {
        setLocks((current) =>
            current.includes(field) ? current.filter((item) => item !== field) : [...current, field]
        );
    }

    async function saveCard() {
        setLocalBusy(true);
        try {
            const savedCard = {
                ...card,
                mustKeep: card.mustKeep.map((line) => line.trim()).filter(Boolean),
                mayChange: card.mayChange.map((line) => line.trim()).filter(Boolean)
            };
            const response = await onAction('design.save', { card: savedCard, lockedFields: locks });
            const saved = response?.project as PanelProps['detail'] | undefined;
            if (saved) {
                setCard(saved.design);
                setLocks(saved.lockedFields);
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : '设计卡保存失败。');
        } finally {
            setLocalBusy(false);
        }
    }

    function applyInstruction() {
        if (!instruction.trim()) return;
        if (dirty) {
            window.alert('请先保存设计卡，再应用自然语言修改；本次修改将以已保存的设计为基础。');
            return;
        }
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
        setLocalBusy(true);
        try {
            await onAction('design.unlock', { fields: [field] });
            const response = await onAction('design.save', { card: nextCard, lockedFields: nextLocks });
            const saved = response?.project as PanelProps['detail'] | undefined;
            if (saved) {
                setCard(saved.design);
                setLocks(saved.lockedFields);
            }
            setLastResult(null);
        } catch (error) {
            setError(error instanceof Error ? error.message : '解锁变更保存失败；草稿已保留，请核对后保存。');
        } finally {
            setLocalBusy(false);
        }
    }

    function renderTextField(entry: (typeof TEXT_FIELDS)[number]) {
        const label = entry.key === 'sceneIntent' ? '场景' : DESIGN_FIELD_LABELS[entry.key];
        return (
            <div key={entry.key} className='space-y-1'>
                <div className='flex items-center justify-between gap-2'>
                    <FieldLabel hint={entry.hint}>{label}</FieldLabel>
                    <label className='text-wb-muted flex min-h-9 items-center gap-1 text-xs' title={`锁定${label}`}>
                        <input
                            type='checkbox'
                            disabled={busy || localBusy}
                            className='accent-wb-accent size-4'
                            checked={locked.has(entry.key)}
                            aria-label={`锁定${label}`}
                            onChange={() => toggleLock(entry.key)}
                        />
                        锁定
                    </label>
                </div>
                <Textarea
                    disabled={busy || localBusy}
                    rows={entry.rows}
                    value={String(card[entry.key] ?? '')}
                    aria-label={label}
                    onChange={(event) => updateField(entry.key, event.target.value)}
                    className='border-wb-border bg-wb-panel text-sm leading-relaxed'
                />
            </div>
        );
    }

    return (
        <div className='space-y-3'>
            <Section
                title='想画什么'
                actions={
                    <div className='flex flex-wrap items-center gap-2'>
                        {dirty && <Badge tone='yellow'>未保存</Badge>}
                        <Button size='sm' variant='outline' disabled={busy || localBusy || !dirty} onClick={saveCard}>
                            保存方案
                        </Button>
                    </div>
                }>
                <div className='space-y-2.5'>
                    {TEXT_FIELDS.filter(({ key }) => isCoreField(key)).map(renderTextField)}
                    <details className='border-wb-border rounded-md border p-3'>
                        <summary className='text-wb-accent cursor-pointer text-sm'>构图、风格和其他细节</summary>
                        <div className='mt-3 space-y-3'>
                            {TEXT_FIELDS.filter(({ key }) => !isCoreField(key)).map(renderTextField)}
                            <h3 className='border-wb-border text-wb-ink mt-5 border-b pb-2 text-[15px] font-semibold'>
                                哪些不能改
                            </h3>
                            {(['mustKeep', 'mayChange'] as const).map((key) => (
                                <div key={key} className='space-y-1'>
                                    <div className='flex items-center justify-between gap-2'>
                                        <FieldLabel hint='每行一项'>{DESIGN_FIELD_LABELS[key]}</FieldLabel>
                                        <label
                                            className='text-wb-muted flex min-h-9 items-center gap-1 text-xs'
                                            title={`锁定范围：${DESIGN_FIELD_LABELS[key]}`}>
                                            <input
                                                type='checkbox'
                                                disabled={busy || localBusy}
                                                className='accent-wb-accent size-4'
                                                aria-label={`锁定${DESIGN_FIELD_LABELS[key]}`}
                                                checked={locked.has(key)}
                                                onChange={() => toggleLock(key)}
                                            />
                                            锁定
                                        </label>
                                    </div>
                                    <Textarea
                                        disabled={busy || localBusy}
                                        rows={3}
                                        value={card[key].join('\n')}
                                        aria-label={DESIGN_FIELD_LABELS[key]}
                                        onChange={(event) => updateField(key, event.target.value.split('\n'))}
                                        className='border-wb-border bg-wb-panel text-sm leading-relaxed'
                                    />
                                </div>
                            ))}
                        </div>
                    </details>
                </div>

                {card.assumptions.length > 0 && (
                    <details className='border-wb-border rounded-md border p-3'>
                        <summary className='text-wb-accent cursor-pointer text-sm'>查看方案依据</summary>
                        <ul className='text-wb-muted mt-1 space-y-1 text-[13px]'>
                            {card.assumptions.map((item, index) => (
                                <li key={`${item.field}-${index}`}>
                                    <span className='text-wb-ink'>
                                        {isDesignFieldKey(item.field) ? DESIGN_FIELD_LABELS[item.field] : item.field}
                                    </span>
                                    ：{item.value}
                                    <span className='text-wb-muted'>（{item.reason}）</span>
                                </li>
                            ))}
                        </ul>
                    </details>
                )}

                {card.missingReferences.length > 0 && (
                    <div className='border-wb-warning bg-wb-warning-soft text-wb-warning rounded border p-2 text-[13px]'>
                        缺失参考：{card.missingReferences.join('、')}
                    </div>
                )}
            </Section>

            <details className='border-wb-border bg-wb-panel rounded-lg border p-4'>
                <summary className='text-wb-accent cursor-pointer text-sm'>用文字调整方案</summary>
                <div className='mt-3 space-y-3'>
                    <Textarea
                        disabled={busy || localBusy}
                        rows={2}
                        placeholder='例如：人物稍微大一点，服装和场景核心关系保持'
                        aria-label='自然语言修改说明'
                        value={instruction}
                        onChange={(event) => setInstruction(event.target.value)}
                        className='border-wb-border bg-wb-panel text-sm leading-relaxed'
                    />
                    <div className='flex items-center justify-between gap-2'>
                        <span className='text-wb-muted text-xs'>
                            {`${plannerModel} · 思考强度 ${plannerEffort} · 1 次规划调用 · 费用未知`}
                        </span>
                        <Button
                            size='sm'
                            variant='outline'
                            disabled={busy || localBusy || !instruction.trim()}
                            onClick={applyInstruction}>
                            应用修改
                        </Button>
                    </div>

                    {lastResult && (
                        <div className='space-y-2'>
                            {lastResult.changeSummary.length > 0 && (
                                <div className='border-wb-success bg-wb-success-soft rounded border p-2'>
                                    <p className='text-wb-success text-[13px] font-medium'>本次变化</p>
                                    <ul className='text-wb-success mt-1 space-y-1 text-[13px]'>
                                        {lastResult.changeSummary.map((change) => (
                                            <li key={change.field}>
                                                <span className='font-medium'>{DESIGN_FIELD_LABELS[change.field]}</span>
                                                ：{change.before || '（空）'} → {change.after || '（空）'}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {lastResult.conflicts.length > 0 && (
                                <div className='border-wb-warning bg-wb-warning-soft rounded border p-2'>
                                    <p className='text-wb-warning text-[13px] font-medium'>锁定冲突（未自动应用）</p>
                                    <ul className='text-wb-warning mt-1 space-y-2 text-[13px]'>
                                        {lastResult.conflicts.map((conflict) => (
                                            <li key={conflict.field} className='space-y-1'>
                                                <div>
                                                    <span className='font-medium'>
                                                        {DESIGN_FIELD_LABELS[conflict.field]}
                                                    </span>
                                                    ：{conflict.proposed}
                                                </div>
                                                <div className='flex items-center justify-between gap-2'>
                                                    <span className='text-wb-warning'>{conflict.reason}</span>
                                                    <Button
                                                        size='sm'
                                                        variant='outline'
                                                        className='border-wb-warning text-wb-warning h-9 text-xs'
                                                        disabled={busy}
                                                        onClick={() =>
                                                            void unlockAndApply(conflict.field, conflict.proposed)
                                                        }>
                                                        解锁并应用此变更
                                                    </Button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {lastResult.changeSummary.length === 0 && lastResult.conflicts.length === 0 && (
                                <p className='text-wb-muted text-[13px]'>模型没有提出有效变化。</p>
                            )}
                        </div>
                    )}
                </div>
            </details>
        </div>
    );
}
