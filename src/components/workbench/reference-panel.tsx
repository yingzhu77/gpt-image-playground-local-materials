'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge, Section, useDraftStatus, useSyncedState, type PanelProps } from '@/components/workbench/shared';
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

export function ReferencePanel({ detail, busy, onAction, requestPaid, notify, refresh, setError }: PanelProps) {
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
    const [libraryError, setLibraryError] = React.useState<string | null>(null);
    const [libraryLoading, setLibraryLoading] = React.useState(false);
    const [expanded, setExpanded] = React.useState<string | null>(null);
    const [selectedAssetId, setSelectedAssetId] = React.useState<string | null>(null);
    const [analysisFailures, setAnalysisFailures] = React.useState<Record<string, string>>({});
    const [externalBindingChange, setExternalBindingChange] = React.useState(false);
    const [analysisDraft, setAnalysisDraft] = React.useState<{
        assetId: string;
        observable: string;
        inferences: string;
        uncertainties: string;
        styleLanguage: string;
    } | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const savedBindings = detail.references.map(({ assetId, purpose, borrow, exclude }) => ({
        assetId,
        purpose,
        borrow,
        exclude
    }));
    const dirty = JSON.stringify(draft) !== JSON.stringify(savedBindings);
    const savedSignature = JSON.stringify(savedBindings);
    const previousSavedBindings = React.useRef(savedBindings);
    React.useEffect(() => {
        const previous = previousSavedBindings.current;
        if (JSON.stringify(previous) === savedSignature) return;
        const next = JSON.parse(savedSignature) as DraftBinding[];
        previousSavedBindings.current = next;
        const added = next.filter((item) => !previous.some((old) => old.assetId === item.assetId));
        // A search import can append a saved reference while this panel holds a
        // different draft. Preserve local edits/removals and include new assets.
        setDraft((current) => {
            if (JSON.stringify(current) === JSON.stringify(previous) || JSON.stringify(current) === savedSignature)
                return next;
            return [...current, ...added.filter((item) => !current.some((entry) => entry.assetId === item.assetId))];
        });
        if (JSON.stringify(draft) !== JSON.stringify(previous) && JSON.stringify(draft) !== savedSignature) {
            queueMicrotask(() => setExternalBindingChange(true));
        }
    }, [savedSignature, setDraft, draft]);
    const editingAnalysis = detail.assets.find((asset) => asset.id === analysisDraft?.assetId)?.analysis;
    const analysisDirty =
        !!analysisDraft &&
        !!editingAnalysis &&
        (analysisDraft.observable !== editingAnalysis.observable.join('\n') ||
            analysisDraft.inferences !== editingAnalysis.inferences.join('\n') ||
            analysisDraft.uncertainties !== editingAnalysis.uncertainties.join('\n') ||
            analysisDraft.styleLanguage !== editingAnalysis.styleLanguage);
    useDraftStatus(`references:${detail.project.id}`, dirty || analysisDirty);

    const boundIds = new Set(draft.map((item) => item.assetId));
    // Uploads reuse an existing asset by hash, including a saved generated image.
    // Keep that image selectable instead of reporting upload success then hiding it.
    const projectAssets = detail.assets;

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
            const response = await onAction('references.save', {
                bindings: draft.map((item, index) => ({ ...item, position: index }))
            });
            const saved = (response?.project as PanelProps['detail'] | undefined)?.references;
            if (saved) {
                const next = saved.map(({ assetId, purpose, borrow, exclude }) => ({
                    assetId,
                    purpose,
                    borrow,
                    exclude
                }));
                previousSavedBindings.current = next;
                setDraft(next);
            }
            setExternalBindingChange(false);
            notify('参考组已保存；提示词会标记为过期，请确认保留手动版或重新编译。');
        } catch (error) {
            setError(error instanceof Error ? error.message : '参考组保存失败。');
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
                try {
                    await onAction('assets.analyze', { assetId: asset.id, confirmAnalysis: true });
                    setAnalysisFailures((current) => {
                        const next = { ...current };
                        delete next[asset.id];
                        return next;
                    });
                    notify('参考图分析已更新。');
                } catch (error) {
                    setAnalysisFailures((current) => ({
                        ...current,
                        [asset.id]: error instanceof Error ? error.message : '分析失败。'
                    }));
                    throw error;
                }
            }
        });
    }

    async function openLibrary() {
        setLibraryOpen(true);
        setLibraryError(null);
        setLibraryLoading(true);
        try {
            const response = await workbenchFetch<{ assets: AssetMeta[] }>('/api/workbench/library');
            setLibrary(response.assets.filter((asset) => asset.kind !== 'generated'));
        } catch (error) {
            setLibraryError(error instanceof Error ? error.message : '读取素材库失败。');
        } finally {
            setLibraryLoading(false);
        }
    }

    return (
        <div className='space-y-3'>
            <Section
                title='参考图组'
                description={`${draft.length} 张 · 顺序和用途会写入确认快照，并实际传给生图与审稿`}
                actions={
                    <div className='flex flex-wrap items-center gap-1.5'>
                        <Badge tone={dirty ? 'yellow' : 'green'}>{dirty ? '参考组未保存' : '已保存'}</Badge>
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

                {externalBindingChange && (
                    <p
                        role='status'
                        className='border-wb-warning bg-wb-warning-soft text-wb-warning rounded border p-2 text-[13px]'>
                        已保存参考组在其他操作中发生变化。当前借用说明与排序草稿已保留，新增参考已合并；请核对后保存。
                    </p>
                )}

                {draft.length === 0 && (
                    <p className='border-wb-border bg-wb-panel text-wb-muted rounded border p-2 text-[13px]'>
                        还没有参考图。上传官图、场景或姿态参考后，设置“借用/不借用”并保存。
                    </p>
                )}

                <ul className='space-y-2'>
                    {draft.map((binding, index) => {
                        const asset =
                            detail.assets.find((item) => item.id === binding.assetId) ??
                            library.find((item) => item.id === binding.assetId);
                        if (!asset) return null;
                        return (
                            <li
                                key={binding.assetId}
                                className={`rounded border p-2 ${selectedAssetId === asset.id ? 'border-wb-accent bg-wb-accent-soft' : 'border-wb-border bg-wb-panel'}`}>
                                <div className='flex items-start gap-2'>
                                    <img
                                        src={`/api/workbench/assets/${asset.id}/file`}
                                        alt={asset.originalName}
                                        className='border-wb-border size-14 shrink-0 rounded border object-cover'
                                    />
                                    <div className='min-w-0 flex-1 space-y-1'>
                                        <div className='flex flex-wrap items-center justify-between gap-1'>
                                            <button
                                                type='button'
                                                className='text-wb-ink decoration-wb-border max-w-full min-w-0 truncate text-left text-[13px] font-medium underline underline-offset-4'
                                                title={asset.originalName}
                                                aria-expanded={selectedAssetId === asset.id}
                                                onClick={() =>
                                                    setSelectedAssetId(selectedAssetId === asset.id ? null : asset.id)
                                                }>
                                                {index + 1}. {asset.originalName}
                                            </button>
                                            <div className='flex gap-1'>
                                                <Button
                                                    size='sm'
                                                    variant='outline'
                                                    className='h-9 min-w-9 px-1 text-xs'
                                                    aria-label={`上移参考图${index + 1}`}
                                                    title='上移参考图'
                                                    disabled={busy || localBusy || index === 0}
                                                    onClick={() => move(index, -1)}>
                                                    ↑
                                                </Button>
                                                <Button
                                                    size='sm'
                                                    variant='outline'
                                                    className='h-9 min-w-9 px-1 text-xs'
                                                    aria-label={`下移参考图${index + 1}`}
                                                    title='下移参考图'
                                                    disabled={busy || localBusy || index === draft.length - 1}
                                                    onClick={() => move(index, 1)}>
                                                    ↓
                                                </Button>
                                                <Button
                                                    size='sm'
                                                    variant='outline'
                                                    className='h-9 px-1 text-xs'
                                                    disabled={busy || localBusy}
                                                    onClick={() =>
                                                        setDraft((current) =>
                                                            current.filter((item) => item.assetId !== binding.assetId)
                                                        )
                                                    }>
                                                    移除
                                                </Button>
                                            </div>
                                        </div>
                                        <div className='flex flex-wrap items-center gap-1'>
                                            <Badge>
                                                {asset.width}×{asset.height}
                                            </Badge>
                                            <Badge>{asset.kind}</Badge>
                                            {analysisFailures[asset.id] ? (
                                                <Badge tone='red'>分析失败</Badge>
                                            ) : asset.analysis ? (
                                                <Badge tone='green'>已分析</Badge>
                                            ) : (
                                                <Badge tone='yellow'>未分析</Badge>
                                            )}
                                            <Badge>{REFERENCE_PURPOSE_LABELS[binding.purpose]}</Badge>
                                        </div>
                                        <p className='text-wb-muted line-clamp-2 text-xs'>
                                            借用：{binding.borrow || '尚未填写'}
                                        </p>
                                        <button
                                            type='button'
                                            className='text-wb-accent min-h-9 text-xs underline'
                                            aria-expanded={selectedAssetId === asset.id}
                                            onClick={() =>
                                                setSelectedAssetId(selectedAssetId === asset.id ? null : asset.id)
                                            }>
                                            {selectedAssetId === asset.id ? '收起参考详情' : '编辑用途与借用说明'}
                                        </button>
                                        {selectedAssetId === asset.id && (
                                            <div className='border-wb-border space-y-2 border-t pt-2'>
                                                <label className='text-wb-muted block text-xs'>参考用途</label>
                                                <Select
                                                    disabled={busy || localBusy}
                                                    value={binding.purpose}
                                                    onValueChange={(value) =>
                                                        setDraft((current) =>
                                                            current.map((item, itemIndex) =>
                                                                itemIndex === index
                                                                    ? { ...item, purpose: value as ReferencePurpose }
                                                                    : item
                                                            )
                                                        )
                                                    }>
                                                    <SelectTrigger
                                                        aria-label={`参考图${index + 1}用途`}
                                                        className='border-wb-border bg-wb-panel h-9 w-full text-sm'>
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
                                                <div className='grid gap-2'>
                                                    <label className='text-wb-muted text-xs'>
                                                        借用说明
                                                        <Input
                                                            disabled={busy || localBusy}
                                                            maxLength={500}
                                                            aria-label={`参考图${index + 1}借用说明`}
                                                            placeholder='借用点（如：服装结构、耳朵轮廓）'
                                                            value={binding.borrow}
                                                            onChange={(event) =>
                                                                setDraft((current) =>
                                                                    current.map((item, itemIndex) =>
                                                                        itemIndex === index
                                                                            ? { ...item, borrow: event.target.value }
                                                                            : item
                                                                    )
                                                                )
                                                            }
                                                            className='border-wb-border bg-wb-panel h-9 text-sm'
                                                        />
                                                    </label>
                                                    <label className='text-wb-muted text-xs'>
                                                        不借用的部分
                                                        <Input
                                                            disabled={busy || localBusy}
                                                            maxLength={500}
                                                            aria-label={`参考图${index + 1}排除说明`}
                                                            placeholder='不借用点（如：站姿、面孔）'
                                                            value={binding.exclude}
                                                            onChange={(event) =>
                                                                setDraft((current) =>
                                                                    current.map((item, itemIndex) =>
                                                                        itemIndex === index
                                                                            ? { ...item, exclude: event.target.value }
                                                                            : item
                                                                    )
                                                                )
                                                            }
                                                            className='border-wb-border bg-wb-panel h-9 text-sm'
                                                        />
                                                    </label>
                                                </div>
                                                {analysisFailures[asset.id] && (
                                                    <p role='alert' className='text-wb-error text-xs'>
                                                        分析失败：{analysisFailures[asset.id]}
                                                        。上传完成不代表图片已经被模型理解。
                                                    </p>
                                                )}
                                                <div className='flex items-center gap-2'>
                                                    <Button
                                                        size='sm'
                                                        variant='outline'
                                                        className='h-9 px-2 text-xs'
                                                        disabled={busy || localBusy}
                                                        onClick={() => analyze(asset)}>
                                                        分析图片
                                                    </Button>
                                                    {asset.analysis && (
                                                        <button
                                                            type='button'
                                                            className='text-wb-muted text-xs underline'
                                                            onClick={() =>
                                                                setExpanded(expanded === asset.id ? null : asset.id)
                                                            }>
                                                            {expanded === asset.id ? '收起分析' : '查看分析'}
                                                        </button>
                                                    )}
                                                </div>
                                                {expanded === asset.id && asset.analysis && (
                                                    <div className='border-wb-border bg-wb-panel text-wb-muted space-y-1 rounded border p-2 text-xs'>
                                                        {analysisDraft?.assetId === asset.id ? (
                                                            <div className='space-y-1'>
                                                                <Textarea
                                                                    disabled={busy || localBusy}
                                                                    aria-label='分析的可观察特征'
                                                                    rows={3}
                                                                    value={analysisDraft.observable}
                                                                    onChange={(event) =>
                                                                        setAnalysisDraft({
                                                                            ...analysisDraft,
                                                                            observable: event.target.value
                                                                        })
                                                                    }
                                                                    className='border-wb-border bg-wb-panel text-sm leading-relaxed'
                                                                    placeholder='可观察特征（每行一项）'
                                                                />
                                                                <Textarea
                                                                    disabled={busy || localBusy}
                                                                    aria-label='分析的推测'
                                                                    rows={2}
                                                                    value={analysisDraft.inferences}
                                                                    onChange={(event) =>
                                                                        setAnalysisDraft({
                                                                            ...analysisDraft,
                                                                            inferences: event.target.value
                                                                        })
                                                                    }
                                                                    className='border-wb-border bg-wb-panel text-sm leading-relaxed'
                                                                    placeholder='推测（每行一项）'
                                                                />
                                                                <Textarea
                                                                    disabled={busy || localBusy}
                                                                    aria-label='分析的不确定项'
                                                                    rows={2}
                                                                    value={analysisDraft.uncertainties}
                                                                    onChange={(event) =>
                                                                        setAnalysisDraft({
                                                                            ...analysisDraft,
                                                                            uncertainties: event.target.value
                                                                        })
                                                                    }
                                                                    className='border-wb-border bg-wb-panel text-sm leading-relaxed'
                                                                    placeholder='不确定（每行一项）'
                                                                />
                                                                <Textarea
                                                                    disabled={busy || localBusy}
                                                                    aria-label='分析的绘画语言'
                                                                    rows={2}
                                                                    value={analysisDraft.styleLanguage}
                                                                    onChange={(event) =>
                                                                        setAnalysisDraft({
                                                                            ...analysisDraft,
                                                                            styleLanguage: event.target.value
                                                                        })
                                                                    }
                                                                    className='border-wb-border bg-wb-panel text-sm leading-relaxed'
                                                                    placeholder='绘画语言'
                                                                />
                                                                <div className='flex gap-1'>
                                                                    <Button
                                                                        size='sm'
                                                                        className='h-9 px-2 text-xs'
                                                                        disabled={busy || localBusy}
                                                                        onClick={() => {
                                                                            void (async () => {
                                                                                setLocalBusy(true);
                                                                                try {
                                                                                    await onAction(
                                                                                        'assets.updateAnalysis',
                                                                                        {
                                                                                            assetId: asset.id,
                                                                                            analysis: {
                                                                                                observable:
                                                                                                    analysisDraft.observable
                                                                                                        .split('\n')
                                                                                                        .map((item) =>
                                                                                                            item.trim()
                                                                                                        )
                                                                                                        .filter(
                                                                                                            Boolean
                                                                                                        ),
                                                                                                inferences:
                                                                                                    analysisDraft.inferences
                                                                                                        .split('\n')
                                                                                                        .map((item) =>
                                                                                                            item.trim()
                                                                                                        )
                                                                                                        .filter(
                                                                                                            Boolean
                                                                                                        ),
                                                                                                uncertainties:
                                                                                                    analysisDraft.uncertainties
                                                                                                        .split('\n')
                                                                                                        .map((item) =>
                                                                                                            item.trim()
                                                                                                        )
                                                                                                        .filter(
                                                                                                            Boolean
                                                                                                        ),
                                                                                                styleLanguage:
                                                                                                    analysisDraft.styleLanguage,
                                                                                                suggestedPurpose:
                                                                                                    asset.analysis
                                                                                                        ?.suggestedPurpose ??
                                                                                                    'style'
                                                                                            }
                                                                                        }
                                                                                    );
                                                                                    setAnalysisDraft(null);
                                                                                    notify(
                                                                                        '分析结果已手动修改并保存（优先于模型缓存）。'
                                                                                    );
                                                                                } catch (error) {
                                                                                    setError(
                                                                                        error instanceof Error
                                                                                            ? error.message
                                                                                            : '分析修改保存失败。'
                                                                                    );
                                                                                } finally {
                                                                                    setLocalBusy(false);
                                                                                }
                                                                            })();
                                                                        }}>
                                                                        保存分析修改
                                                                    </Button>
                                                                    <Button
                                                                        size='sm'
                                                                        variant='outline'
                                                                        className='h-9 px-2 text-xs'
                                                                        onClick={() => setAnalysisDraft(null)}>
                                                                        取消
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <p>
                                                                    <span className='text-wb-ink'>可观察：</span>
                                                                    {asset.analysis.observable.join('；')}
                                                                </p>
                                                                <p>
                                                                    <span className='text-wb-ink'>推测：</span>
                                                                    {asset.analysis.inferences.join('；')}
                                                                </p>
                                                                <p>
                                                                    <span className='text-wb-ink'>不确定：</span>
                                                                    {asset.analysis.uncertainties.join('；')}
                                                                </p>
                                                                <p>
                                                                    <span className='text-wb-ink'>绘画语言：</span>
                                                                    {asset.analysis.styleLanguage}
                                                                </p>
                                                                <p className='text-wb-muted'>
                                                                    模型：{asset.analysis.model}
                                                                </p>
                                                                <Button
                                                                    size='sm'
                                                                    variant='outline'
                                                                    className='h-9 px-2 text-xs'
                                                                    onClick={() => {
                                                                        if (
                                                                            analysisDirty &&
                                                                            analysisDraft?.assetId !== asset.id &&
                                                                            !window.confirm(
                                                                                '另一张参考图的分析修改尚未保存。放弃该修改并编辑当前图片？'
                                                                            )
                                                                        )
                                                                            return;
                                                                        setAnalysisDraft({
                                                                            assetId: asset.id,
                                                                            observable:
                                                                                asset.analysis!.observable.join('\n'),
                                                                            inferences:
                                                                                asset.analysis!.inferences.join('\n'),
                                                                            uncertainties:
                                                                                asset.analysis!.uncertainties.join(
                                                                                    '\n'
                                                                                ),
                                                                            styleLanguage: asset.analysis!.styleLanguage
                                                                        });
                                                                    }}>
                                                                    编辑分析
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
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
                    <Button size='sm' disabled={busy || localBusy || !dirty} onClick={() => void saveBindings()}>
                        保存参考组（免费）
                    </Button>
                </div>
            </Section>

            <Section title='项目素材' description='项目原图与已有作品；按实际用途加入参考，不会自动分析。'>
                {projectAssets.length === 0 ? (
                    <p className='text-wb-muted text-[13px]'>暂无素材。</p>
                ) : (
                    <ul className='space-y-1.5'>
                        {projectAssets.map((asset) => (
                            <li key={asset.id} className='flex items-center gap-2'>
                                <img
                                    src={`/api/workbench/assets/${asset.id}/file`}
                                    alt={asset.originalName}
                                    className='border-wb-border size-8 rounded border object-cover'
                                />
                                <span className='text-wb-ink min-w-0 flex-1 truncate text-[13px]'>
                                    {asset.originalName}
                                </span>
                                <span className='text-wb-muted text-xs'>
                                    {asset.width}×{asset.height}
                                </span>
                                {boundIds.has(asset.id) ? (
                                    <Badge tone='green'>已加入</Badge>
                                ) : (
                                    <Button
                                        size='sm'
                                        variant='outline'
                                        className='h-9 px-2 text-xs'
                                        disabled={busy || localBusy}
                                        onClick={() => addAsset(asset)}>
                                        加入参考组
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
                <DialogContent className='border-wb-border bg-wb-panel max-h-[80vh] max-w-3xl overflow-y-auto'>
                    <DialogHeader>
                        <DialogTitle>从已有素材选用</DialogTitle>
                        <DialogDescription>跨项目复用同一原图资产；每个项目可绑定不同用途。</DialogDescription>
                    </DialogHeader>
                    <div className='grid gap-2 sm:grid-cols-2'>
                        {library.map((asset) => (
                            <div key={asset.id} className='border-wb-border flex items-center gap-2 rounded border p-2'>
                                <img
                                    src={`/api/workbench/assets/${asset.id}/file`}
                                    alt={asset.originalName}
                                    className='border-wb-border size-12 rounded border object-cover'
                                />
                                <div className='min-w-0 flex-1'>
                                    <p className='text-wb-ink truncate text-[13px]'>{asset.originalName}</p>
                                    <p className='text-wb-muted text-xs'>
                                        {asset.width}×{asset.height} · {asset.sha256.slice(0, 10)}
                                    </p>
                                </div>
                                <Button
                                    size='sm'
                                    variant='outline'
                                    className='h-9 text-xs'
                                    disabled={busy || localBusy || boundIds.has(asset.id)}
                                    onClick={() => addAsset(asset)}>
                                    {boundIds.has(asset.id) ? '已加入' : '选用'}
                                </Button>
                            </div>
                        ))}
                    </div>
                    {libraryLoading && (
                        <p role='status' className='text-wb-muted text-sm'>
                            正在读取素材库…
                        </p>
                    )}
                    {libraryError && (
                        <p role='alert' className='text-wb-error text-sm'>
                            {libraryError}
                        </p>
                    )}
                    {!libraryLoading && !libraryError && library.length === 0 && (
                        <p className='text-wb-muted text-sm'>素材库为空。</p>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
