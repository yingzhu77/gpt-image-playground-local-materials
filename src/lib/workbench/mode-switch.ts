import { isWorkbenchMock } from '@/lib/workbench/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type RuntimeMode = 'mock' | 'real';

export const RUNTIME_MODES: readonly RuntimeMode[] = ['mock', 'real'];
const HEARTBEAT_FRESH_MS = 10_000;

export function getCurrentRuntimeMode(): RuntimeMode {
    return isWorkbenchMock() ? 'mock' : 'real';
}

export function getModeRuntimeDir(): string {
    const configured = process.env.WORKBENCH_MODE_DIR?.trim();
    return path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured || '.workbench-data');
}

function heartbeatPath(): string {
    return path.join(/*turbopackIgnore: true*/ getModeRuntimeDir(), 'mode-watcher-heartbeat.json');
}

function requestPath(): string {
    return path.join(/*turbopackIgnore: true*/ getModeRuntimeDir(), 'mode-restart-request.json');
}

export function getModeWatcherStatus(): {
    available: boolean;
    updatedAt: number | null;
    port: number | null;
} {
    try {
        const raw = fs.readFileSync(heartbeatPath(), 'utf8');
        const parsed = JSON.parse(raw) as { updatedAt?: unknown; port?: unknown };
        const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : null;
        return {
            available: updatedAt !== null && Date.now() - updatedAt < HEARTBEAT_FRESH_MS,
            updatedAt,
            port: typeof parsed.port === 'number' ? parsed.port : null
        };
    } catch {
        return { available: false, updatedAt: null, port: null };
    }
}

export function requestModeRestart(mode: RuntimeMode): { requestId: string } {
    const dir = getModeRuntimeDir();
    fs.mkdirSync(dir, { recursive: true });
    const requestId = crypto.randomUUID();
    const target = requestPath();
    const tempPath = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(
        tempPath,
        `${JSON.stringify({ mode, requestId, requestedAt: Date.now() }, null, 2)}\n`,
        'utf8'
    );
    fs.renameSync(tempPath, target);
    return { requestId };
}
