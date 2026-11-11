import { errorResponse, requireLoopbackHost, verifyAppPassword, workbenchJson } from '@/lib/workbench/http';
import { cancelLocalStop, canStopLocalService, requestLocalStop, reserveLocalStop } from '@/lib/workbench/local-lifecycle';
import { WorkbenchError } from '@/lib/workbench/service';
import { hasActiveRuns } from '@/lib/workbench/store';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
    try {
        requireLoopbackHost(request);
        const origin = request.headers.get('origin');
        if (!origin || origin !== `http://${request.headers.get('host')}`) {
            throw new WorkbenchError(403, 'ORIGIN_MISMATCH', '只能从本机工作台页面停止服务。');
        }
        verifyAppPassword(request);
        if (!canStopLocalService()) {
            throw new WorkbenchError(409, 'LOCAL_STOP_UNAVAILABLE', '请从启动服务的终端停止。');
        }
        if (!reserveLocalStop(hasActiveRuns)) {
            throw new WorkbenchError(409, 'LOCAL_SERVICE_BUSY', '还有操作或任务正在处理，请等它们结束后再停止。');
        }
        try {
            await requestLocalStop();
        } catch {
            cancelLocalStop();
            throw new WorkbenchError(503, 'LOCAL_STOP_FAILED', '后台进程未确认停止，请稍后重试。');
        }
        return workbenchJson({ accepted: true }, 202);
    } catch (error) {
        return errorResponse(error);
    }
}
