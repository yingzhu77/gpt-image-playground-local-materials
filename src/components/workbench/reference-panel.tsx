'use client';

import { Badge, Section, useSyncedState, type PanelProps } from '@/components/workbench/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { uploadProjectFile, workbenchFetch } from '@/lib/workbench/client';
import type { AssetMeta, ReferencePurpose } from '@/lib/workbench/types';
import { REFERENCE_PURPOSE_LABELS, REFERENCE_PURPOSES } from '@/lib/workbench/types';
import * as React from 'react';

type DraftBinding = {
    assetId: string;
    purpose: ReferencePurpose;
    borrow: string;
    exclude: string;
};

function assetsSignature(detail: PanelProps['detail']) {
    return detail.references
        .map((binding) => `${binding.assetId}:${binding.purpose}:${binding.borrow}:${binding.exclude}`)
        .join('|');
}

export function ReferencePanel({ detail, busy, onAction, requestPaid, notify, refresh }: PanelProps) {
    const [draft, setDraft] = useSyncedState<DraftBinding[]>(
        detail.references.map((binding) => ({
            assetId: binding.assetId,
            purpose: binding.purpose,
            borrow: binding.borrow,
            exclude: binding.exclude
        })),
        `${detail.project.id}:${assetsSignature(detail)}`
    );
    const [localBusy, setLocalBusy] = React.useState(false);
    const [libraryOpen, setLibraryOpen] = React.useState(false);
    const [library, setLibrary] = React.useState<AssetMeta[]>([]);
    const [expanded, setExpanded] = React.useState<string | null>(null);
    const [analysisDraft, setAnalysisDraft] = React.useState<{
        assetId: string;
        observable: string;
        inferences: string;
        uncertainties: string;
        styleLanguage: string;
    } | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const boundIds = new Set(draft.map((item) => item.assetId));
    const projectAssets = detail.assets.filter((asset) => asset.kind !== 'generated');

    async function handleUpload(file: File) {
        setLocalBusy(true);
        try {
            await uploadProjectFile(detail.project.id, file);
            await refresh();
            notify(`已上传 ${file.name}（原图按内容哈希保存）。请设置用途后加入参考组。`);
        } catch (error) {
            notify(error instanceof Error ? error.message : '上传失败。');
        } finally {
            setLocalBusy(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }

    function addAsset(asset: AssetMeta, purpose: ReferencePurpose = 'style') {
        if (boundIds.has(asset.id)) return;
        setDraft((current) => [...current, { assetId: asset.id, purpose, borrow: '', exclude: '' }]);
        notify(`已加入参考组（草稿）：${asset.originalName}。保存参考组后生效。`);
    }

    function move(index: number, direction: -1 | 1) {
        const next = [...draft];
        const target = index + direction;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        setDraft(next);
    }

    async function saveBindings() {
        setLocalBusy(true);
        try {
            await onAction('references.save', {
                bindings: draft.map((item, index) => ({ ...item, position: index }))
            });
            notify('参考组已保存；提示词会标记为过期，请确认保留手动版或重新编译。');
        } finally {
            setLocalBusy(false);
        }
    }

    function analyze(asset: AssetMeta) {
        requestPaid({
            title: '分析参考图',
            description: '视觉模型会实际接收图片，区分可观察特征与推测，并建议用途。分析结果按文件哈希缓存。',
            lines: ['视觉模型调用：1 次', '费用：未知（视觉模型价格未配置）', '不会生图、不会搜索'],
            confirmLabel: '确认分析（1 次视觉调用）',
            onConfirm: async () => {
                await onAction('assets.analyze', { assetId: asset.id, confirmAnalysis: true });
                notify('参考图分析已更新。');
            }
        });
    }

    async function openLibrary() {
        setLibraryOpen(true);
        try {
            const response = await workbenchFetch<{ assets: AssetMeta[] }>('/api/workbench/library');
            setLibrary(response.assets.filter((asset) => asset.kind !== 'generated'));
        } catch (error) {
            notify(error instanceof Error ? error.message : '读取素材库失败。');
        }
    }

    return (
        <div className='space-y-3'>
            <Section
                title='参考图组'
                description={`${draft.length} 张 · 顺序和用途会写入确认快照，并实际传给生图与审稿`}
                actions={
                    <div className='flex gap-1.5'>
                        <Button size='sm' variant='outline' onClick={() => void openLibrary()}>
                            从已有素材选用
                        </Button>
                        <Button size='sm' variant='outline' onClick={() => fileInputRef.current?.click()}>
                            上传
                        </Button>
                    </div>
                }>
                <input
                    ref={fileInputRef}
                    type='file'
                    accept='image/png,image/jpeg,image/webp'
                    className='hidden'
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleUpload(file);
                    }}
                />

                {draft.length === 0 && (
                    <p className='rounded border border-neutral-800 bg-neutral-950/40 p-2 text-[11px] text-neutral-500'>
                        还没有参考图。上传官图、场景或姿态参考后，设置“借用/不借用”并保存。
                    </p>
                )}

                <ul className='space-y-2'>
                    {draft.map((binding, index) => {
                        const asset = detail.assets.find((item) => item.id === binding.assetId);
                        if (!asset) return null;
                        return (
                            <li key={binding.assetId} className='rounded border border-neutral-800 bg-neutral-950/40 p-2'>
                                <div className='flex items-start gap-2'>
                                    <img
                                        src={`/api/workbench/assets/${asset.id}/file`}
                                        alt={asset.originalName}
                                        className='size-14 shrink-0 rounded border border-neutral-800 object-cover'
                                    />
                                    <div className='min-w-0 flex-1 space-y-1'>
                                        <div className='flex items-center justify-between gap-1'>
                                            <span className='truncate text-[11px] font-medium text-neutral-200'>
                                                {index + 1}. {asset.originalName}
                                            </span>
                                            <div className='flex gap-1'>
                                                <Button size='sm' variant='outline' className='h-6 px-1 text-[10px]' onClick={() => move(index, -1)}>
                                                    ↑
                                                </Button>
                                                <Button size='sm' variant='outline' className='h-6 px-1 text-[10px]' onClick={() => move(index, 1)}>
                                                    ↓
                                                </Button>
                                                <Button
                                                    size='sm'
                                                    variant='outline'
                                                    className='h-6 px-1 text-[10px]'
                                                    onClick={() => setDraft((current) => current.filter((item) => item.assetId !== binding.assetId))}>
                                                    移除
                                                </Button>
                                            </div>
                                        </div>
                                        <div className='flex flex-wrap items-center gap-1'>
                                            <Badge>{asset.width}×{asset.height}</Badge>
                                            <Badge tone={asset.mock ? 'purple' : 'neutral'}>{asset.kind}</Badge>
                                            {asset.analysis ? <Badge tone='green'>已分析</Badge> : <Badge tone='yellow'>未分析</Badge>}
                                            <Select
                                                value={binding.purpose}
                                                onValueChange={(value) =>
                                                    setDraft((current) =>
                                                        current.map((item, itemIndex) =>
                                                            itemIndex === index ? { ...item, purpose: value as ReferencePurpose } : item
                                                        )
                                                    )
                                                }>
                                                <SelectTrigger className='h-7 w-[150px] border-neutral-700 bg-neutral-950 text-[11px]'>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {REFERENCE_PURPOSES.map((purpose) => (
                                                        <SelectItem key={purpose} value={purpose}>
                                                            {REFERENCE_PURPOSE_LABELS[purpose]}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className='grid gap-1 md:grid-cols-2'>
                                            <Input
                                                placeholder='借用点（如：服装结构、耳朵轮廓）'
                                                value={binding.borrow}
                                                onChange={(event) =>
                                                    setDraft((current) =>
                                                        current.map((item, itemIndex) =>
                                                            itemIndex === index ? { ...item, borrow: event.target.value } : item
                                                        )
                                                    )
                                                }
                                                className='h-7 border-neutral-700 bg-neutral-950/60 text-[11px]'
                                            />
                                            <Input
                                                placeholder='不借用点（如：站姿、面孔）'
                                                value={binding.exclude}
                                                onChange={(event) =>
                                                    setDraft((current) =>
                                                        current.map((item, itemIndex) =>
                                                            itemIndex === index ? { ...item, exclude: event.target.value } : item
                                                        )
                                                    )
                                                }
                                                className='h-7 border-neutral-700 bg-neutral-950/60 text-[11px]'
                                            />
                                        </div>
                                        <div className='flex items-center gap-2'>
                                            <Button size='sm' variant='outline' className='h-6 px-2 text-[10px]' disabled={busy || localBusy} onClick={() => analyze(asset)}>
                                                分析图片
                                            </Button>
                                            {asset.analysis && (
                                                <button
                                                    type='button'
                                                    className='text-[10px] text-neutral-400 underline'
                                                    onClick={() => setExpanded(expanded === asset.id ? null : asset.id)}>
                                                    {expanded === asset.id ? '收起分析' : '查看分析'}
                                                </button>
                                            )}
                                        </div>
                                        {expanded === asset.id && asset.analysis && (
                                            <div className='space-y-1 rounded border border-neutral-800 bg-neutral-900/60 p-2 text-[10px] text-neutral-400'>
                                                {analysisDraft?.assetId === asset.id ? (
                                                    <div className='space-y-1'>
                                                        <Textarea
                                                            rows={3}
                                                            value={analysisDraft.observable}
                                                            onChange={(event) =>
                                                                setAnalysisDraft({ ...analysisDraft, observable: event.target.value })
                                                            }
                                                            className='border-neutral-700 bg-neutral-950 text-[10px]'
                                                            placeholder='可观察特征（每行一项）'
                                                        />
                                                        <Textarea
                                                            rows={2}
                                                            value={analysisDraft.inferences}
                                                            onChange={(event) =>
                                                                setAnalysisDraft({ ...analysisDraft, inferences: event.target.value })
                                                            }
                                                            className='border-neutral-700 bg-neutral-950 text-[10px]'
                                                            placeholder='推测（每行一项）'
                                                        />
                                                        <Textarea
                                                            rows={2}
                                                            value={analysisDraft.uncertainties}
                                                            onChange={(event) =>
                                                                setAnalysisDraft({ ...analysisDraft, uncertainties: event.target.value })
                                                            }
                                                            className='border-neutral-700 bg-neutral-950 text-[10px]'
                                                            placeholder='不确定（每行一项）'
                                                        />
                                                        <Textarea
                                                            rows={2}
                                                            value={analysisDraft.styleLanguage}
                                                            onChange={(event) =>
                                                                setAnalysisDraft({ ...analysisDraft, styleLanguage: event.target.value })
                                                            }
                                                            className='border-neutral-700 bg-neutral-950 text-[10px]'
                                                            placeholder='绘画语言'
                                                        />
                                                        <div className='flex gap-1'>
                                                            <Button
                                                                size='sm'
                                                                className='h-6 px-2 text-[10px]'
                                                                disabled={busy || localBusy}
                                                                onClick={() => {
                                                                    void (async () => {
                                                                        setLocalBusy(true);
                                                                        try {
                                                                            await onAction('assets.updateAnalysis', {
                                                                                assetId: asset.id,
                                                                                analysis: {
                                                                                    observable: analysisDraft.observable.split('\n').map((item) => item.trim()).filter(Boolean),
                                                                                    inferences: analysisDraft.inferences.split('\n').map((item) => item.trim()).filter(Boolean),
                                                                                    uncertainties: analysisDraft.uncertainties.split('\n').map((item) => item.trim()).filter(Boolean),
                                                                                    styleLanguage: analysisDraft.styleLanguage,
                                                                                    suggestedPurpose: asset.analysis?.suggestedPurpose ?? 'style'
                                                                                }
                                                                            });
                                                                            setAnalysisDraft(null);
                                                                            notify('分析结果已手动修改并保存（优先于模型缓存）。');
                                                                        } finally {
                                                                            setLocalBusy(false);
                                                                        }
                                                                    })();
                                                                }}>
                                                                保存分析修改
                                                            </Button>
                                                            <Button size='sm' variant='outline' className='h-6 px-2 text-[10px]' onClick={() => setAnalysisDraft(null)}>
                                                                取消
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <p><span className='text-neutral-200'>可观察：</span>{asset.analysis.observable.join('；')}</p>
                                                        <p><span className='text-neutral-200'>推测：</span>{asset.analysis.inferences.join('；')}</p>
                                                        <p><span className='text-neutral-200'>不确定：</span>{asset.analysis.uncertainties.join('；')}</p>
                                                        <p><span className='text-neutral-200'>绘画语言：</span>{asset.analysis.styleLanguage}</p>
                                                        <p className='text-neutral-500'>{asset.analysis.model === 'mock-analysis' ? 'Mock 分析，非同真实看图。' : `模型：${asset.analysis.model}`}</p>
                                                        <Button
                                                            size='sm'
                                                            variant='outline'
                                                            className='h-6 px-2 text-[10px]'
                                                            onClick={() =>
                                                                setAnalysisDraft({
                                                                    assetId: asset.id,
                                                                    observable: asset.analysis!.observable.join('\n'),
                                                                    inferences: asset.analysis!.inferences.join('\n'),
                                                                    uncertainties: asset.analysis!.uncertainties.join('\n'),
                                                                    styleLanguage: asset.analysis!.styleLanguage
                                                                })
                                                            }>
                                                            编辑分析
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>

                <div className='flex justify-end'>
                    <Button size='sm' disabled={busy || localBusy || draft.length === 0} onClick={() => void saveBindings()}>
                        保存参考组（免费）
                    </Button>
                </div>
            </Section>

            <Section title='项目素材' description='上传或导入的素材；可复用，不必重复上传。'>
                {projectAssets.length === 0 ? (
                    <p className='text-[11px] text-neutral-500'>暂无素材。</p>
                ) : (
                    <ul className='space-y-1.5'>
                        {projectAssets.map((asset) => (
                            <li key={asset.id} className='flex items-center gap-2'>
                                <img
                                    src={`/api/workbench/assets/${asset.id}/file`}
                                    alt={asset.originalName}
                                    className='size-8 rounded border border-neutral-800 object-cover'
                                />
                                <span className='min-w-0 flex-1 truncate text-[11px] text-neutral-300'>{asset.originalName}</span>
                                <span className='text-[10px] text-neutral-500'>{asset.width}×{asset.height}</span>
                                {boundIds.has(asset.id) ? (
                                    <Badge tone='green'>已加入</Badge>
                                ) : (
                                    <Button size='sm' variant='outline' className='h-6 px-2 text-[10px]' onClick={() => addAsset(asset)}>
                                        加入参考组
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
                <DialogContent className='max-h-[80vh] max-w-3xl overflow-y-auto border-neutral-800 bg-neutral-950'>
                    <DialogHeader>
                        <DialogTitle>从已有素材选用</DialogTitle>
                        <DialogDescription>跨项目复用同一原图资产；每个项目可绑定不同用途。</DialogDescription>
                    </DialogHeader>
                    <div className='grid gap-2 sm:grid-cols-2'>
                        {library.map((asset) => (
                            <div key={asset.id} className='flex items-center gap-2 rounded border border-neutral-800 p-2'>
                                <img
                                    src={`/api/workbench/assets/${asset.id}/file`}
                                    alt={asset.originalName}
                                    className='size-12 rounded border border-neutral-800 object-cover'
                                />
                                <div className='min-w-0 flex-1'>
                                    <p className='truncate text-[11px] text-neutral-200'>{asset.originalName}</p>
                                    <p className='text-[10px] text-neutral-500'>{asset.width}×{asset.height} · {asset.sha256.slice(0, 10)}</p>
                                </div>
                                <Button
                                    size='sm'
                                    variant='outline'
                                    className='h-7 text-[10px]'
                                    disabled={boundIds.has(asset.id)}
                                    onClick={() => addAsset(asset)}>
                                    {boundIds.has(asset.id) ? '已加入' : '选用'}
                                </Button>
                            </div>
                        ))}
                    </div>
                    {library.length === 0 && <p className='text-xs text-neutral-500'>素材库为空。</p>}
                </DialogContent>
            </Dialog>
        </div>
    );
}
