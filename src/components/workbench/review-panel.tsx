'use client';

import { Badge, Section, type PanelProps } from '@/components/workbench/shared';
import { Button } from '@/components/ui/button';
import type { ReviewIssueType } from '@/lib/workbench/types';
import * as React from 'react';

const ISSUE_LABELS: Record<ReviewIssueType, { label: string; tone: 'red' | 'yellow' | 'blue' }> = {
    visible_deviation: { label: '可见偏差', tone: 'red' },
    uncertainty: { label: '不确定疑点', tone: 'yellow' },
    aesthetic: { label: '审美建议', tone: 'blue' }
};

const CONFIDENCE_LABELS: Record<string, string> = {
    high: '高确定度',
    medium: '中确定度',
    low: '低确定度'
};

export function ReviewPanel({
    detail,
    busy,
    selectedVersionId,
    onOpenRevision,
    onAction,
    notify
}: PanelProps & { onOpenRevision: (versionId: string, suggestions?: { change: string; keep: string }[]) => void }) {
    const version =
        detail.versions.find((item) => item.id === selectedVersionId) ?? detail.versions[detail.versions.length - 1] ?? null;
    const review = version?.review ?? null;
    const latestRun = detail.runs[0] ?? null;
    const batchComparison =
        review?.comparison ??
        (version
            ? detail.versions.find((item) => item.runId === version.runId && item.review?.comparison)?.review?.comparison ?? null
            : null);
    const [localBusy, setLocalBusy] = React.useState(false);

    async function setBaseline() {
        if (!version) return;
        setLocalBusy(true);
        try {
            await onAction('version.baseline', { versionId: version.id });
            notify(`已把 ${version.label} 设为基准。`);
        } finally {
            setLocalBusy(false);
        }
    }

    return (
        <div className='space-y-3'>
            <Section
                title='审稿与建议'
                description={version ? `当前版本 ${version.label} · ${version.reviewStatus === 'available' ? '已审稿' : version.reviewStatus === 'pending' ? '审稿排队中' : '审稿暂不可用'}` : '还没有结果'}
                actions={
                    version ? (
                        <div className='flex gap-1.5'>
                            {!version.isBaseline && (
                                <Button size='sm' variant='outline' disabled={busy || localBusy} onClick={() => void setBaseline()}>
                                    设为基准
                                </Button>
                            )}
                            <Button
                                size='sm'
                                disabled={busy}
                                onClick={() =>
                                    onOpenRevision(
                                        version.id,
                                        review?.issues.map((issue) => ({ change: issue.change, keep: issue.keep })).filter((item) => item.change || item.keep)
                                    )
                                }>
                                修一版
                            </Button>
                        </div>
                    ) : undefined
                }>
                {!version && <p className='text-[11px] text-neutral-500'>生成结果后，这里会显示自动审稿。</p>}
                {version && !review && (
                    <div className='rounded border border-neutral-800 bg-neutral-950/40 p-2 text-[11px] text-neutral-400'>
                        {version.reviewStatus === 'pending'
                            ? '审稿尚未完成。图片已保存；审稿失败不会重新生成图片。'
                            : '审稿暂不可用（结构化返回不合格或调用失败）。图片已保留，可稍后人工判断或手动重试审稿。'}
                    </div>
                )}
                {review && (
                    <div className='space-y-2'>
                        <div className='flex flex-wrap items-center gap-1.5'>
                            <Badge tone={review.acceptable ? 'green' : 'yellow'}>
                                {review.acceptable ? '本轮可接受' : '建议修订'}
                            </Badge>
                            <Badge>{review.mock ? 'Mock 审稿' : review.model}</Badge>
                        </div>
                        <p className='text-[11px] leading-relaxed text-neutral-300'>{review.summary}</p>

                        {review.compliant.length > 0 && (
                            <div>
                                <p className='text-[10px] font-medium text-neutral-400'>符合的部分</p>
                                <ul className='mt-0.5 space-y-0.5 text-[11px] text-neutral-400'>
                                    {review.compliant.map((item, index) => (
                                        <li key={`${item.aspect}-${index}`}>
                                            <span className='text-green-300'>{item.aspect}</span>：{item.note}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {review.issues.length > 0 && (
                            <div>
                                <p className='text-[10px] font-medium text-neutral-400'>最多两个优先问题</p>
                                <ul className='mt-1 space-y-1.5'>
                                    {review.issues.map((issue, index) => {
                                        const meta = ISSUE_LABELS[issue.type];
                                        return (
                                            <li key={`${issue.aspect}-${index}`} className='rounded border border-neutral-800 bg-neutral-950/40 p-2'>
                                                <div className='flex flex-wrap items-center gap-1'>
                                                    <Badge tone={meta.tone}>{meta.label}</Badge>
                                                    <Badge>{CONFIDENCE_LABELS[issue.confidence] ?? issue.confidence}</Badge>
                                                    <span className='text-[11px] font-medium text-neutral-200'>{issue.aspect}</span>
                                                </div>
                                                <p className='mt-1 text-[11px] text-neutral-300'>{issue.problem}</p>
                                                <p className='text-[10px] text-neutral-500'>依据：{issue.evidence}</p>
                                                {issue.keep && <p className='text-[10px] text-green-300/80'>建议保留：{issue.keep}</p>}
                                                {issue.change && <p className='text-[10px] text-yellow-200/80'>建议修改：{issue.change}</p>}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}

                        {batchComparison && (
                            <div className='rounded border border-blue-700/40 bg-blue-950/20 p-2'>
                                <p className='text-[10px] font-medium text-blue-200'>两张比较与推荐</p>
                                <p className='mt-0.5 text-[11px] text-blue-100/80'>
                                    推荐 {batchComparison.recommendedLabel}：{batchComparison.reason}
                                </p>
                                <p className='mt-1 text-[10px] text-blue-200/60'>AI 推荐不会自动设为基准；请人工选择。</p>
                            </div>
                        )}
                    </div>
                )}
            </Section>

            <Section title='本次快照' description='确认后的不可变记录；后续改草稿不影响已排队任务。'>
                {latestRun ? (
                    <div className='space-y-1 text-[10px] text-neutral-400'>
                        <p>操作：{latestRun.action} · 状态：{latestRun.status}</p>
                        <p>模型：{latestRun.snapshot.params.model} · {latestRun.snapshot.params.size} · {latestRun.snapshot.params.quality}</p>
                        <p>图片：{latestRun.snapshot.params.imageCount} 张 · 审稿：{latestRun.snapshot.review.enabled ? '是' : '否'}（{latestRun.snapshot.review.model}）</p>
                        <p>参考顺序：{latestRun.snapshot.references.length > 0 ? latestRun.snapshot.references.map((ref) => `${ref.position + 1}.${ref.purpose}`).join(' / ') : '无'}</p>
                        <p>估算：图片 ${latestRun.snapshot.estimate.estimatedImageUsd === null ? '未知' : latestRun.snapshot.estimate.estimatedImageUsd.toFixed(4)} · 审稿费用未知</p>
                        <p>锁定项：{latestRun.snapshot.lockedFields.length > 0 ? latestRun.snapshot.lockedFields.join('、') : '无'}</p>
                        <details>
                            <summary className='cursor-pointer text-neutral-500'>查看提示词快照</summary>
                            <pre className='mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-neutral-950 p-2 text-[10px] text-neutral-400'>
                                {latestRun.snapshot.prompt}
                            </pre>
                        </details>
                    </div>
                ) : (
                    <p className='text-[11px] text-neutral-500'>还没有已确认快照。</p>
                )}
            </Section>
        </div>
    );
}
