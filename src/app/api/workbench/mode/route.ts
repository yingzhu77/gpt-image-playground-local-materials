import {
    assertSameOrigin,
    errorResponse,
    readJsonBody,
    requireLoopbackHost,
    verifyAppPassword,
    workbenchJson
} from '@/lib/workbench/http';
import {
    getCurrentRuntimeMode,
    getModeWatcherStatus,
    requestModeRestart,
    type RuntimeMode
} from '@/lib/workbench/mode-switch';
import { WorkbenchError } from '@/lib/workbench/service';
import { hasActiveRuns } from '@/lib/workbench/store';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        requireLoopbackHost(request);
        verifyAppPassword(request);
        const watcher = getModeWatcherStatus();
        return workbenchJson({
            mode: getCurrentRuntimeMode(),
            autoRestartAvailable: watcher.available,
            activeRuns: hasActiveRuns()
        });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function POST(request: NextRequest) {
    try {
        requireLoopbackHost(request);
        assertSameOrigin(request);
        verifyAppPassword(request);
        const body = await readJsonBody(request);
        const mode = body.mode;
        if (mode !== 'mock' && mode !== 'real') {
            throw new WorkbenchError(400, 'INVALID_MODE', 'mode 只支持 mock 或 real。');
        }
        if (body.confirm !== true) {
            throw new WorkbenchError(400, 'CONFIRM_REQUIRED', '切换模式需要显式确认。');
        }
        const current = getCurrentRuntimeMode();
        if (mode === current) {
            throw new WorkbenchError(409, 'ALREADY_IN_MODE', `当前已经是 ${mode} 模式。`);
        }
        if (hasActiveRuns()) {
            throw new WorkbenchError(
                409,
                'ACTIVE_RUNS',
                '还有排队或执行中的任务。请先等待完成或停止，再切换模式，避免丢失在途结果。'
            );
        }
        const watcher = getModeWatcherStatus();
        if (!watcher.available) {
            throw new WorkbenchError(
                409,
                'AUTO_RESTART_UNAVAILABLE',
                '一键切换需要由 scripts/start-local.mjs 启动服务。当前未检测到启动器，请手动停止后重启：真实模式 node scripts/start-local.mjs；Mock 模式 WORKBENCH_MOCK=1 node scripts/start-local.mjs。'
            );
        }
        const { requestId } = requestModeRestart(mode as RuntimeMode);
        return workbenchJson({
            ok: true,
            requestId,
            mode,
            autoRestartAvailable: true,
            message: '已请求启动器重启 Web 与 worker，请稍候刷新页面。'
        });
    } catch (error) {
        return errorResponse(error);
    }
}
