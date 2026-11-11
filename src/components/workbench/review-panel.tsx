'use client';

import { Button } from '@/components/ui/button';
import { Badge, RunStatusBadge, Section, type PanelProps } from '@/components/workbench/shared';
import { DESIGN_FIELD_LABELS, REFERENCE_PURPOSE_LABELS, type ReviewIssueType } from '@/lib/workbench/types';
import * as React from 'react';

const ISSUE_LABELS: Record<ReviewIssueType, { label: string; tone: 'red' | 'yellow' | 'blue' }> = {
    visible_deviation: { label: '可见偏差', tone: 'red' },
    uncertainty: { label: '不确定疑点', tone: 'yellow' },
    aesthetic: { label: '审美建议', tone: 'blue' }
};
const CONFIDENCE_LABELS: Record<string, string> = { high: '高确定度', medium: '中确定度', low: '低确定度' };

export function ReviewPanel({
    detail,
    busy,
    selectedVersionId,
    onOpenRevision,
    onAction,
    notify,
    setError
}: PanelProps & { onOpenRevision: (versionId: string, suggestions?: { change: string; keep: string }[]) => void }) {
    const version =
        detail.versions.find((item) => item.id === selectedVersionId) ??
        detail.versions[detail.versions.length - 1] ??
        null;
    const review = version?.review ?? null;
    const selectedRun = detail.runs.find((run) => run.id === version?.runId);
    const batchComparison =
        review?.comparison ??
        (version
            ? (detail.versions.find((item) => item.runId === version.runId && item.review?.comparison)?.review
                  ?.comparison ?? null)
            : null);
    const [localBusy, setLocalBusy] = React.useState(false);

    async function setBaseline() {
        if (!version) return;
        setLocalBusy(true);
        try {
            const result = await onAction('version.baseline', { versionId: version.id });
            if (result) notify(`已把 ${version.label} 设为基准。`);
        } catch (error) {
            setError(error instanceof Error ? error.message : '基准设置未确认，请刷新核对。');
        } finally {
            setLocalBusy(false);
        }
    }

    return (
        <div className='min-w-0 space-y-4'>
            <Section
                title='审稿与建议'
                description={
                    version
                        ? `当前 ${version.label} · ${version.reviewStatus === 'available' ? '已审稿' : version.reviewStatus === 'pending' ? '审稿排队中' : '审稿暂不可用'}`
                        : '生成后查看本轮结论与优先问题'
                }>
                {!version && (
                    <div className='text-wb-muted py-6 text-sm leading-relaxed'>
                        <p className='text-wb-ink mb-2 font-medium'>还没有审稿</p>
                        <p>生成结果后，这里会显示自动审稿。你仍可以自行判断作品，并选择基准。</p>
                    </div>
                )}
                {version && !review && (
                    <div className='border-wb-border bg-wb-subtle text-wb-muted rounded-md border p-3 text-sm leading-relaxed'>
                        {version.reviewStatus === 'pending'
                            ? '审稿尚未完成。图片已保存；审稿失败不会重新生成图片。'
                            : '审稿暂不可用（结构化返回不合格或调用失败）。图片已保留，可以人工判断。'}
                    </div>
                )}
                {review && (
                    <div className='space-y-4'>
                        <div className='flex flex-wrap items-center gap-2'>
                            <Badge tone={review.acceptable ? 'green' : 'yellow'}>
                                {review.acceptable ? '本轮可接受' : '建议修订'}
                            </Badge>
                            <Badge>{review.model}</Badge>
                        </div>
                        <p className='text-wb-ink text-sm leading-relaxed'>{review.summary}</p>
                        {review.issues.length > 0 && (
                            <div>
                                <h3 className='text-wb-muted mb-2 text-xs font-medium'>优先处理</h3>
                                <ol className='space-y-3'>
                                    {review.issues.slice(0, 2).map((issue, index) => {
                                        const meta = ISSUE_LABELS[issue.type];
                                        return (
                                            <li
                                                key={`${issue.aspect}-${index}`}
                                                className='border-wb-border border-t pt-3'>
                                                <div className='mb-2 flex flex-wrap items-center gap-2'>
                                                    <span className='text-wb-ink text-sm font-semibold'>
                                                        {index + 1}. {issue.aspect}
                                                    </span>
                                                    <Badge tone={meta.tone}>{meta.label}</Badge>
                                                </div>
                                                <p className='text-wb-ink text-sm leading-relaxed'>{issue.problem}</p>
                                                <details className='mt-2'>
                                                    <summary className='text-wb-accent cursor-pointer text-xs'>
                                                        查看依据与修改建议
                                                    </summary>
                                                    <div className='text-wb-muted mt-2 space-y-2 text-xs leading-relaxed'>
                                                        <Badge>
                                                            {CONFIDENCE_LABELS[issue.confidence] ?? issue.confidence}
                                                        </Badge>
                                                        <p>依据：{issue.evidence}</p>
                                                        {issue.keep && (
                                                            <p>
                                                                <span className='text-wb-success font-medium'>
                                                                    建议保留：
                                                                </span>
                                                                {issue.keep}
                                                            </p>
                                                        )}
                                                        {issue.change && (
                                                            <p>
                                                                <span className='text-wb-warning font-medium'>
                                                                    建议修改：
                                                                </span>
                                                                {issue.change}
                                                            </p>
                                                        )}
                                                    </div>
                                                </details>
                                            </li>
                                        );
                                    })}
                                </ol>
                            </div>
                        )}
                        {(review.compliant.length > 0 || review.issues.length > 2) && (
                            <details className='border-wb-border border-t pt-3'>
                                <summary className='text-wb-muted cursor-pointer text-xs'>查看其余审稿细节</summary>
                                <div className='text-wb-muted mt-3 space-y-3 text-xs leading-relaxed'>
                                    {review.compliant.length > 0 && (
                                        <div>
                                            <p className='text-wb-ink mb-1 font-medium'>符合的部分</p>
                                            <ul className='space-y-1'>
                                                {review.compliant.map((item, index) => (
                                                    <li key={`${item.aspect}-${index}`}>
                                                        <span className='text-wb-success'>{item.aspect}</span>：
                                                        {item.note}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {review.issues.slice(2).map((issue, index) => (
                                        <div key={`${issue.aspect}-${index}`}>
                                            <p className='text-wb-ink font-medium'>
                                                {issue.aspect} · {ISSUE_LABELS[issue.type].label}
                                            </p>
                                            <p>{issue.problem}</p>
                                            <p>依据：{issue.evidence}</p>
                                            {issue.keep && <p>建议保留：{issue.keep}</p>}
                                            {issue.change && <p>建议修改：{issue.change}</p>}
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )}
                        {batchComparison && (
                            <div className='border-wb-border bg-wb-accent-soft rounded-md border p-3'>
                                <p className='text-wb-accent text-xs font-medium'>两张比较与推荐</p>
                                <p className='text-wb-ink mt-2 text-sm leading-relaxed'>
                                    推荐 {batchComparison.recommendedLabel}：{batchComparison.reason}
                                </p>
                                <p className='text-wb-muted mt-2 text-xs'>AI 推荐不会自动设为基准，请人工选择。</p>
                            </div>
                        )}
                    </div>
                )}
                {version && (
                    <div className='border-wb-border flex flex-wrap gap-2 border-t pt-3'>
                        {!version.isBaseline && (
                            <Button
                                size='sm'
                                variant='outline'
                                className='h-9'
                                disabled={busy || localBusy}
                                onClick={() => void setBaseline()}>
                                设为基准
                            </Button>
                        )}
                        <Button
                            size='sm'
                            variant='outline'
                            className='h-9'
                            disabled={busy}
                            onClick={() =>
                                onOpenRevision(
                                    version.id,
                                    review?.issues
                                        .map((issue) => ({ change: issue.change, keep: issue.keep }))
                                        .filter((item) => item.change || item.keep)
                                )
                            }>
                            修一版
                        </Button>
                    </div>
                )}
            </Section>
            <Section title='这张图的生成设置'>
                {selectedRun ? (
                    <div className='text-wb-muted space-y-3 text-xs leading-relaxed'>
                        <div className='flex flex-wrap items-center gap-2'>
                            <RunStatusBadge status={selectedRun.status} />
                            <span>{selectedRun.snapshot.params.imageCount} 张 · 真实调用</span>
                        </div>
                        <p className='text-wb-ink text-sm'>
                            图片估算 $
                            {selectedRun.snapshot.estimate.estimatedImageUsd === null
                                ? '未知'
                                : selectedRun.snapshot.estimate.estimatedImageUsd.toFixed(4)}{' '}
                            · 审稿费用未知
                        </p>
                        <details>
                            <summary className='text-wb-accent cursor-pointer'>查看模型、参数与提示词</summary>
                            <div className='mt-3 space-y-2'>
                                <p>
                                    模型：{selectedRun.snapshot.params.model} · {selectedRun.snapshot.params.size} ·{' '}
                                    {selectedRun.snapshot.params.quality}
                                </p>
                                <p>
                                    审稿：{selectedRun.snapshot.review.enabled ? '是' : '否'}（
                                    {selectedRun.snapshot.review.model}）
                                </p>
                                <p>
                                    参考顺序：
                                    {selectedRun.snapshot.references.length > 0
                                        ? selectedRun.snapshot.references
                                              .map(
                                                  (ref) =>
                                                      `${ref.position + 1}.${REFERENCE_PURPOSE_LABELS[ref.purpose]}`
                                              )
                                              .join(' / ')
                                        : '无'}
                                </p>
                                <p>
                                    锁定项：
                                    {selectedRun.snapshot.lockedFields.length > 0
                                        ? selectedRun.snapshot.lockedFields
                                              .map((field) => DESIGN_FIELD_LABELS[field])
                                              .join('、')
                                        : '无'}
                                </p>
                                <pre className='bg-wb-subtle text-wb-ink max-h-80 overflow-auto rounded-md p-3 font-sans text-sm leading-relaxed break-words whitespace-pre-wrap'>
                                    {selectedRun.snapshot.prompt}
                                </pre>
                            </div>
                        </details>
                    </div>
                ) : (
                    <p className='text-wb-muted text-sm'>还没有已确认快照。</p>
                )}
            </Section>
        </div>
    );
}
