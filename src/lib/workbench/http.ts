import { ConfigurationError } from '@/lib/server/image-api';
import { WorkbenchError } from '@/lib/workbench/service';
import { getWorkerToken } from '@/lib/workbench/config';
import { FixtureWorkbenchError } from '@/lib/workbench/test-fixtures';
import { StructuredOutputError } from '@/lib/workbench/schema';
import { SafeDownloadError } from '@/lib/workbench/fetcher';
import { SearchProviderError } from '@/lib/workbench/search';
import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

const MAX_JSON_BYTES = 2 * 1024 * 1024;

export function workbenchJson(body: Record<string, unknown>, status = 200) {
    return NextResponse.json(body, {
        status,
        headers: {
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        }
    });
}

export function assertSameOrigin(request: NextRequest) {
    const host = request.headers.get('host');
    const origin = request.headers.get('origin');
    if (!origin) return;
    try {
        const parsed = new URL(origin);
        if (!host || parsed.host.toLowerCase() !== host.toLowerCase()) {
            throw new WorkbenchError(403, 'ORIGIN_MISMATCH', '仅允许同源页面调用工作台接口。');
        }
    } catch {
        throw new WorkbenchError(403, 'ORIGIN_MISMATCH', '来源无法验证。');
    }
}

export function verifyAppPassword(request: NextRequest) {
    const password = process.env.APP_PASSWORD;
    if (!password) return;
    const header = request.headers.get('x-app-password-hash');
    if (!header) {
        throw new WorkbenchError(401, 'APP_AUTH_REQUIRED', '需要访问密码。请在旧入口或工作台重新输入密码。');
    }
    const expected = crypto.createHash('sha256').update(password).digest('hex');
    const actual = header.trim();
    if (
        actual.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(actual, 'utf8'), Buffer.from(expected, 'utf8'))
    ) {
        throw new WorkbenchError(401, 'APP_AUTH_FAILED', '访问密码不正确。');
    }
}

export function requireWorkerToken(request: NextRequest) {
    const token = getWorkerToken();
    if (!token) {
        throw new WorkbenchError(503, 'WORKER_TOKEN_MISSING', '服务端尚未配置 worker token。');
    }
    const provided = request.headers.get('x-worker-token') ?? '';
    if (
        provided.length !== token.length ||
        !crypto.timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(token, 'utf8'))
    ) {
        throw new WorkbenchError(401, 'WORKER_TOKEN_INVALID', 'worker token 无效。');
    }
    const host = request.headers.get('host') ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
        throw new WorkbenchError(403, 'WORKER_HOST_INVALID', 'worker 只允许通过本机地址调用。');
    }
}

export function requireLoopbackHost(request: NextRequest) {
    const host = request.headers.get('host') ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
        throw new WorkbenchError(403, 'LOOPBACK_ONLY', '工作台只允许本机访问。');
    }
}

export async function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
        throw new WorkbenchError(413, 'BODY_TOO_LARGE', '请求体过大。');
    }
    let text: string;
    try {
        text = await request.text();
    } catch {
        throw new WorkbenchError(400, 'BODY_READ_FAILED', '无法读取请求体。');
    }
    if (text.length > MAX_JSON_BYTES) {
        throw new WorkbenchError(413, 'BODY_TOO_LARGE', '请求体过大。');
    }
    try {
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('not object');
        }
        return parsed as Record<string, unknown>;
    } catch {
        throw new WorkbenchError(400, 'INVALID_JSON', '请求体不是有效的 JSON 对象。');
    }
}

export function errorResponse(error: unknown) {
    if (error instanceof WorkbenchError) {
        return workbenchJson(
            { error: error.message, code: error.code, details: error.details ?? null },
            error.status
        );
    }
    if (error instanceof ConfigurationError) {
        return workbenchJson({ error: error.message, code: error.code }, 503);
    }
    if (error instanceof FixtureWorkbenchError) {
        return workbenchJson({ error: error.message, code: 'TEST_FIXTURE_ERROR' }, 500);
    }
    if (error instanceof StructuredOutputError) {
        return workbenchJson({ error: `结构化输出不合格：${error.message}`, code: 'STRUCTURED_OUTPUT_INVALID' }, 502);
    }
    if (error instanceof SafeDownloadError) {
        return workbenchJson({ error: error.message, code: error.code }, 422);
    }
    if (error instanceof SearchProviderError) {
        return workbenchJson(
            { error: error.message, code: error.code, warnings: error.warnings },
            422
        );
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('[workbench] unhandled error', {
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: message.slice(0, 300)
    });
    return workbenchJson({ error: `工作台处理失败：${message.slice(0, 300)}`, code: 'WORKBENCH_ERROR' }, 500);
}

export function sanitizeFilename(name: string): string {
    return name.replace(/[^\w.\-()\u4e00-\u9fa5]/g, '_').slice(0, 120) || 'download';
}
