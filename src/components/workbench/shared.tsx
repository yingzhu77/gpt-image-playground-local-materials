'use client';

import type { ProjectDetail, WorkbenchStatus } from '@/lib/workbench/types';
import * as React from 'react';

export type PaidRequest = {
    title: string;
    description: string;
    lines: string[];
    confirmLabel?: string;
    onConfirm: () => Promise<void> | void;
};

export type PanelProps = {
    detail: ProjectDetail;
    status: WorkbenchStatus;
    busy: boolean;
    selectedVersionId: string | null;
    plannerModel: string;
    plannerEffort: string;
    onSelectVersion: (id: string) => void;
    onAction: (action: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
    requestPaid: (request: PaidRequest) => void;
    notify: (message: string) => void;
    setError: (message: string | null) => void;
    refresh: () => Promise<void>;
};

export function Badge({
    children,
    tone = 'neutral'
}: {
    children: React.ReactNode;
    tone?: 'neutral' | 'green' | 'yellow' | 'red' | 'purple' | 'blue';
}) {
    const tones: Record<string, string> = {
        neutral: 'border-neutral-700 bg-neutral-800 text-neutral-300',
        green: 'border-green-500/40 bg-green-900/30 text-green-300',
        yellow: 'border-yellow-500/40 bg-yellow-900/30 text-yellow-200',
        red: 'border-red-500/40 bg-red-900/30 text-red-300',
        purple: 'border-purple-500/40 bg-purple-900/30 text-purple-200',
        blue: 'border-blue-500/40 bg-blue-900/30 text-blue-200'
    };
    return (
        <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${tones[tone]}`}>
            {children}
        </span>
    );
}

export function Section({
    title,
    description,
    actions,
    children
}: {
    title: string;
    description?: string;
    actions?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className='rounded-lg border border-neutral-800 bg-neutral-900/50'>
            <header className='flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2'>
                <div>
                    <h2 className='text-sm font-semibold text-neutral-100'>{title}</h2>
                    {description && <p className='mt-0.5 text-[11px] text-neutral-400'>{description}</p>}
                </div>
                {actions}
            </header>
            <div className='space-y-3 p-3'>{children}</div>
        </section>
    );
}

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
    return (
        <div className='flex items-baseline justify-between gap-2'>
            <span className='text-[11px] font-medium text-neutral-300'>{children}</span>
            {hint && <span className='text-[10px] text-neutral-500'>{hint}</span>}
        </div>
    );
}

export function Spinner({ label }: { label?: string }) {
    return (
        <span className='inline-flex items-center gap-2 text-xs text-neutral-400'>
            <span className='size-3 animate-spin rounded-full border border-neutral-600 border-t-neutral-200' />
            {label}
        </span>
    );
}

export function RunStatusBadge({ status }: { status: string }) {
    const map: Record<string, { label: string; tone: 'neutral' | 'green' | 'yellow' | 'red' | 'purple' | 'blue' }> = {
        queued: { label: '排队中', tone: 'blue' },
        running: { label: '执行中', tone: 'blue' },
        completed: { label: '已完成', tone: 'green' },
        partial: { label: '部分成功', tone: 'yellow' },
        failed: { label: '失败', tone: 'red' },
        stopped: { label: '已停止', tone: 'neutral' },
        paused_unknown: { label: '结果未知 · 待核实', tone: 'yellow' },
        paused_budget: { label: '预算/费用暂停', tone: 'yellow' }
    };
    const entry = map[status] ?? { label: status, tone: 'neutral' as const };
    return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

export function useSyncedState<T>(source: T, key: string): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [value, setValue] = React.useState<T>(source);
    const lastKey = React.useRef(key);
    React.useEffect(() => {
        if (lastKey.current !== key) {
            lastKey.current = key;
            setValue(source);
        }
    }, [key, source]);
    return [value, setValue];
}

export function isActiveRun(detail: ProjectDetail | null): boolean {
    if (!detail) return false;
    const activeStatuses = new Set(['queued', 'running']);
    return detail.runs.some(
        (run) =>
            activeStatuses.has(run.status) || run.items.some((item) => item.status === 'pending' || item.status === 'sending')
    );
}
