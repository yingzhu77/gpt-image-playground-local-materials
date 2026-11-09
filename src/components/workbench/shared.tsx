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
        neutral: 'border-wb-border bg-wb-subtle text-wb-muted',
        green: 'border-wb-success bg-wb-success-soft text-wb-success',
        yellow: 'border-wb-warning bg-wb-warning-soft text-wb-warning',
        red: 'border-wb-error bg-wb-error-soft text-wb-error',
        purple: 'border-wb-accent bg-wb-accent-soft text-wb-accent',
        blue: 'border-wb-info bg-wb-info-soft text-wb-info'
    };
    return (
        <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${tones[tone]}`}>
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
        <section className='border-wb-border bg-wb-panel rounded-lg border'>
            <header className='border-wb-border flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3'>
                <div>
                    <h2 className='text-wb-ink text-base font-semibold'>{title}</h2>
                    {description && <p className='text-wb-muted mt-1 text-xs leading-relaxed'>{description}</p>}
                </div>
                {actions}
            </header>
            <div className='space-y-4 p-4'>{children}</div>
        </section>
    );
}

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
    return (
        <div className='flex items-baseline justify-between gap-2'>
            <span className='text-wb-ink text-sm font-medium'>{children}</span>
            {hint && <span className='text-wb-muted text-xs'>{hint}</span>}
        </div>
    );
}

export function Spinner({ label }: { label?: string }) {
    return (
        <span className='text-wb-muted inline-flex items-center gap-2 text-sm'>
            <span
                aria-hidden='true'
                className='border-wb-border border-t-wb-accent size-3 animate-spin rounded-full border'
            />
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
    const previous = React.useRef({ key, source: JSON.stringify(source) });
    React.useEffect(() => {
        const serialized = JSON.stringify(source);
        if (previous.current.key !== key || previous.current.source !== serialized) {
            const was = previous.current.source;
            previous.current = { key, source: serialized };
            // Polling may update server metadata while a user is typing. Only clean
            // inputs follow the server; saved values already equal the new source.
            setValue((current) => (JSON.stringify(current) === was ? source : current));
        }
    }, [key, source]);
    return [value, setValue];
}

export const DraftStatusContext = React.createContext<(key: string, dirty: boolean) => void>(() => {});

export function useDraftStatus(key: string, dirty: boolean) {
    const report = React.useContext(DraftStatusContext);
    React.useEffect(() => {
        report(key, dirty);
        return () => report(key, false);
    }, [key, dirty, report]);
}

export function handleTabListKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = tabs.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
        event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.focus();
    tabs[next]?.click();
}

export function isActiveRun(detail: ProjectDetail | null): boolean {
    if (!detail) return false;
    const activeStatuses = new Set(['queued', 'running']);
    return detail.runs.some(
        (run) =>
            activeStatuses.has(run.status) ||
            run.items.some((item) => item.status === 'pending' || item.status === 'sending')
    );
}
