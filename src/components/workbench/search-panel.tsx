'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Section, type PanelProps } from '@/components/workbench/shared';
import { REFERENCE_PURPOSE_LABELS, type SearchQueryKind } from '@/lib/workbench/types';
import * as React from 'react';

const QUERY_ROWS: { kind: SearchQueryKind; label: string; placeholder: string }[] = [
    { kind: 'official', label: '官图 / 角色外观', placeholder: '角色名 官方 设定图' },
    { kind: 'pose', label: '姿势 / 动作', placeholder: '行走 侧背面 姿态参考' },
    { kind: 'space', label: '空间 / 场景结构', placeholder: '舞台 街景 背板 木支架' },
    { kind: 'style', label: '风格 / 绘画语言', placeholder: '动画插画 色彩 光线 风格' }
];

export function SearchPanel({ detail, status, busy, onAction, requestPaid, notify }: PanelProps) {
    const [queries, setQueries] = React.useState<Record<SearchQueryKind, string>>({
        official: '',
        pose: '',
        space: '',
        style: ''
    });
    const [localBusy, setLocalBusy] = React.useState(false);
    const [failedThumbnails, setFailedThumbnails] = React.useState<Record<string, boolean>>({});
    const candidates = detail.candidates;

    function suggestQueries() {
        const subject = detail.design.subject.split('（')[0].slice(0, 30);
        setQueries({
            official: `${subject} 官方 设定图`,
            pose: '动画人物 行走 侧背面 姿态 参考',
            space: '舞台 街景 布景 结构 木支架 参考',
            style: '动画插画 色彩 光线 边缘 风格 参考'
        });
        notify('已填入较通用的搜索词，避免把完整设计描述发送到互联网；请确认或修改后再搜索。');
    }

    function startSearch() {
        const filled = QUERY_ROWS.map((row) => ({ kind: row.kind, query: queries[row.kind].trim() })).filter(
            (item) => item.query.length >= 2
        );
        if (filled.length === 0) {
            notify('请至少填写一条搜索词。');
            return;
        }
        requestPaid({
            title: '联网搜索参考图',
            description:
                '每条搜索词会发起一次联网图片搜索，只发送搜索词，不发送设计卡或整个项目内容。结果会显示真实来源与未核验状态。',
            lines: [
                `联网搜索调用：${filled.length} 次（上限 ${status.limits.maxSearchQueries}）`,
                '费用：未知（搜索模型价格未配置）',
                '不会自动导入或生成图片；只有你选用后才进入参考组'
            ],
            confirmLabel: `确认搜索（${filled.length} 次）`,
            onConfirm: async () => {
                setLocalBusy(true);
                try {
                    const response = await onAction('search.run', {
                        queries: filled,
                        confirmSearch: true
                    });
                    const warnings = Array.isArray(response?.warnings) ? response.warnings : [];
                    if (warnings.length > 0) notify(String(warnings[0]));
                    else notify('搜索完成；请逐张核验来源并选用。');
                } finally {
                    setLocalBusy(false);
                }
            }
        });
    }

    async function importCandidate(
        candidateId: string,
        bind: boolean,
        suggestedPurpose: PanelProps['detail']['candidates'][number]['suggestedPurpose']
    ) {
        setLocalBusy(true);
        try {
            const response = await onAction('candidate.import', { candidateId });
            const asset = response?.asset as { id: string } | undefined;
            const latest = (response?.project as PanelProps['detail'] | undefined) ?? detail;
            if (bind && asset) {
                if (latest.references.some((binding) => binding.assetId === asset.id)) {
                    notify('该图片已在参考组中；现有用途与说明已保留。');
                    return;
                }
                await onAction('references.save', {
                    bindings: [
                        ...latest.references.map((binding, index) => ({
                            assetId: binding.assetId,
                            purpose: binding.purpose,
                            borrow: binding.borrow,
                            exclude: binding.exclude,
                            position: index
                        })),
                        {
                            assetId: asset.id,
                            purpose: suggestedPurpose,
                            borrow: '',
                            exclude: '',
                            position: latest.references.length
                        }
                    ]
                });
                notify('已导入并加入参考组；请编辑借用/不借用说明后再次保存。');
            } else {
                notify('已导入为项目素材。');
            }
        } catch (error) {
            notify(error instanceof Error ? error.message : '候选图导入失败。');
        } finally {
            setLocalBusy(false);
        }
    }

    return (
        <Section
            title='联网补充参考图'
            description={`真实搜索上限 ${status.limits.maxSearchQueries} 条 × ${status.limits.maxSearchResultsPerQuery} 条结果；候选与已选参考严格分开。`}
            actions={
                <Button size='sm' variant='outline' onClick={suggestQueries}>
                    按设计卡建议搜索词
                </Button>
            }>
            <div className='space-y-2'>
                {QUERY_ROWS.map((row) => (
                    <div key={row.kind} className='space-y-0.5'>
                        <label htmlFor={`search-${row.kind}`} className='text-wb-muted text-xs'>
                            {row.label}
                        </label>
                        <Input
                            id={`search-${row.kind}`}
                            value={queries[row.kind]}
                            placeholder={row.placeholder}
                            onChange={(event) =>
                                setQueries((current) => ({ ...current, [row.kind]: event.target.value }))
                            }
                            className='border-wb-border bg-wb-panel h-9 text-sm'
                        />
                    </div>
                ))}
            </div>
            <div className='flex items-center justify-between gap-2'>
                <span className='text-wb-muted text-xs'>联网搜索可能产生费用；结果来源需自行核验</span>
                <Button size='sm' variant='outline' disabled={busy || localBusy} onClick={startSearch}>
                    联网搜索
                </Button>
            </div>

            <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                    <p className='text-wb-ink text-[13px] font-medium'>候选图（{candidates.length}）</p>
                    <span className='text-wb-muted text-xs'>未选用前不会传给生图模型</span>
                </div>
                {candidates.length === 0 && (
                    <p className='border-wb-border bg-wb-panel text-wb-muted rounded border p-2 text-[13px]'>
                        暂无候选。搜索无结果时会显示实际数量，不用无关图片补位。
                    </p>
                )}
                <ul className='space-y-2'>
                    {candidates.map((candidate) => (
                        <li key={candidate.id} className='border-wb-border bg-wb-panel rounded border p-2'>
                            <div className='space-y-2'>
                                <div>
                                    {candidate.thumbnailUrl && !failedThumbnails[candidate.id] ? (
                                        <img
                                            src={candidate.thumbnailUrl}
                                            alt={candidate.title}
                                            referrerPolicy='no-referrer'
                                            className='border-wb-border aspect-video max-h-40 w-full rounded border object-cover'
                                            onError={() =>
                                                setFailedThumbnails((current) => ({ ...current, [candidate.id]: true }))
                                            }
                                        />
                                    ) : (
                                        <div className='border-wb-border bg-wb-subtle text-wb-muted flex min-h-24 items-center justify-center rounded border text-xs'>
                                            {failedThumbnails[candidate.id]
                                                ? '缩略图加载失败 · 原来源保留'
                                                : '无缩略图'}
                                        </div>
                                    )}
                                    <p className='text-wb-muted mt-0.5 text-xs'>
                                        预览为来源缩略图；导入时下载原图并校验真实字节。
                                    </p>
                                </div>
                                <div className='min-w-0 flex-1 space-y-1'>
                                    <p className='text-wb-ink line-clamp-2 text-[13px]'>{candidate.title}</p>
                                    <div className='flex flex-wrap gap-1'>
                                        <Badge
                                            tone={
                                                candidate.status === 'imported'
                                                    ? 'green'
                                                    : candidate.status === 'failed'
                                                      ? 'red'
                                                      : 'neutral'
                                            }>
                                            {candidate.status === 'imported'
                                                ? '已导入'
                                                : candidate.status === 'failed'
                                                  ? '导入失败'
                                                  : '候选'}
                                        </Badge>
                                        <Badge tone='blue'>
                                            {REFERENCE_PURPOSE_LABELS[candidate.suggestedPurpose]}
                                        </Badge>
                                        <Badge>
                                            {QUERY_ROWS.find((row) => row.kind === candidate.queryKind)?.label ??
                                                candidate.queryKind}
                                        </Badge>
                                        <Badge tone='yellow'>授权未核验</Badge>
                                        <Badge>
                                            {candidate.width && candidate.height
                                                ? `${candidate.width}×${candidate.height}`
                                                : '尺寸待导入'}
                                        </Badge>
                                    </div>
                                    <a
                                        href={candidate.pageUrl}
                                        target='_blank'
                                        rel='noreferrer'
                                        className='text-wb-info block text-xs break-all underline'>
                                        {candidate.domain} · {candidate.pageUrl}
                                    </a>
                                    <p className='text-wb-muted text-xs'>{candidate.trustNote}</p>
                                    <p className='text-wb-muted text-xs'>{candidate.licenseNote}</p>
                                    {candidate.error && (
                                        <p role='alert' className='text-wb-error text-[13px]'>
                                            导入失败：{candidate.error}
                                        </p>
                                    )}
                                    <div className='flex flex-wrap gap-1'>
                                        {candidate.status !== 'imported' && (
                                            <Button
                                                size='sm'
                                                variant='outline'
                                                className='h-9 px-2 text-xs'
                                                disabled={busy || localBusy}
                                                onClick={() =>
                                                    void importCandidate(
                                                        candidate.id,
                                                        false,
                                                        candidate.suggestedPurpose
                                                    )
                                                }>
                                                仅导入
                                            </Button>
                                        )}
                                        <Button
                                            size='sm'
                                            variant='outline'
                                            className='h-9 px-2 text-xs'
                                            disabled={busy || localBusy}
                                            onClick={() =>
                                                void importCandidate(candidate.id, true, candidate.suggestedPurpose)
                                            }>
                                            {candidate.status === 'imported' ? '加入参考组' : '导入并加入参考组'}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </Section>
    );
}
