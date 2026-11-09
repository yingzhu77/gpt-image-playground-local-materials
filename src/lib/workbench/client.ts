'use client';

export type WorkbenchApiError = {
    error: string;
    code: string;
    details?: unknown;
};

export async function workbenchFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (!headers.has('content-type') && init?.body && typeof init.body === 'string') {
        headers.set('content-type', 'application/json');
    }
    const passwordHash = typeof window !== 'undefined' ? window.localStorage.getItem('clientPasswordHash') : null;
    if (passwordHash) headers.set('x-app-password-hash', passwordHash);
    const response = await fetch(path, {
        ...init,
        headers,
        cache: 'no-store'
    });
    const text = await response.text();
    let body: unknown = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = null;
    }
    if (!response.ok) {
        const payload = (body ?? {}) as Partial<WorkbenchApiError>;
        throw new Error(payload.error || `请求失败（HTTP ${response.status}）`);
    }
    return body as T;
}

export function projectAction<T extends Record<string, unknown>>(
    projectId: string,
    body: Record<string, unknown>
): Promise<T> {
    return workbenchFetch<T>(`/api/workbench/projects/${projectId}/actions`, {
        method: 'POST',
        body: JSON.stringify(body)
    });
}

export function uploadProjectFile(projectId: string, file: File): Promise<Record<string, unknown>> {
    const formData = new FormData();
    formData.append('file', file);
    return workbenchFetch<Record<string, unknown>>(`/api/workbench/projects/${projectId}/upload`, {
        method: 'POST',
        body: formData
    });
}

export function newActionId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function formatUsd(value: number | null): string {
    if (value === null) return '未知';
    return `$${value.toFixed(4)}`;
}

export function formatTime(iso: string | null): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function stripProtocol(url: string): string {
    return url.replace(/^https?:\/\//, '').slice(0, 80);
}
