import { hasOpenAiApiKey, isImageApiEnabled, setRuntimeApiConfig } from '@/lib/server/runtime-config';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const MAX_API_KEY_LENGTH = 4096;
const MAX_BODY_LENGTH = 16 * 1024;
const ENV_LOCAL_PATH = path.join(process.cwd(), '.env.local');

function jsonResponse(body: Record<string, unknown>, status = 200) {
    return NextResponse.json(body, {
        status,
        headers: {
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        }
    });
}

function getLoopbackHostname(hostHeader: string | null): string | null {
    if (!hostHeader) return null;
    try {
        const hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
        return hostname === '127.0.0.1' || hostname === 'localhost' ? hostname : null;
    } catch {
        return null;
    }
}

function isSameOrigin(originHeader: string | null, hostHeader: string): boolean {
    if (!originHeader) return false;
    try {
        const origin = new URL(originHeader);
        if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return false;
        return origin.host.toLowerCase() === hostHeader.toLowerCase();
    } catch {
        return false;
    }
}

function isValidRequest(request: NextRequest): boolean {
    const hostHeader = request.headers.get('host');
    if (!getLoopbackHostname(hostHeader)) return false;
    if (!isSameOrigin(request.headers.get('origin'), hostHeader!)) return false;
    if (request.headers.get('x-local-setup') !== '1') return false;
    const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    return contentType === 'application/json';
}

function normalizeApiKey(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const apiKey = value.trim();
    if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH) return null;
    if (/[\s\u0000-\u001f\u007f]/.test(apiKey)) return null;
    return apiKey;
}

function formatEnvValue(value: string): string {
    return /^[A-Za-z0-9._:-]+$/.test(value) ? value : JSON.stringify(value);
}

function updateEnvContent(content: string, entries: [string, string][]): string {
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const hadTrailingNewline = content.endsWith('\n');
    const lines = content === '' ? [] : content.split(/\r?\n/);
    if (hadTrailingNewline && lines.length > 0) lines.pop();

    for (const [key, value] of entries) {
        const matcher = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
        let found = false;
        for (let index = 0; index < lines.length; index++) {
            if (matcher.test(lines[index])) {
                lines[index] = `${key}=${formatEnvValue(value)}`;
                found = true;
            }
        }
        if (!found) lines.push(`${key}=${formatEnvValue(value)}`);
    }

    const body = lines.join(eol);
    return hadTrailingNewline || content === '' ? `${body}${eol}` : body;
}

async function persistEnvLocal(apiKey: string, enabled: boolean): Promise<void> {
    let content = '';
    try {
        content = await fs.readFile(ENV_LOCAL_PATH, 'utf8');
    } catch (error) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) {
            throw error;
        }
    }

    const nextContent = updateEnvContent(content, [
        ['OPENAI_API_KEY', apiKey],
        ['ENABLE_IMAGE_API', enabled ? 'true' : 'false']
    ]);

    const tempPath = `${ENV_LOCAL_PATH}.${process.pid}.${Date.now()}.tmp`;
    try {
        await fs.writeFile(tempPath, nextContent, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(tempPath, ENV_LOCAL_PATH);
    } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}

export async function POST(request: NextRequest) {
    if (!isValidRequest(request)) {
        return jsonResponse({ ok: false, error: '仅允许从本机页面向 127.0.0.1 或 localhost 配置 API Key。' }, 403);
    }

    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_LENGTH) {
        return jsonResponse({ ok: false, error: '请求体过大。' }, 413);
    }

    let payload: unknown;
    try {
        const bodyText = await request.text();
        if (bodyText.length > MAX_BODY_LENGTH) {
            return jsonResponse({ ok: false, error: '请求体过大。' }, 413);
        }
        payload = JSON.parse(bodyText);
    } catch {
        return jsonResponse({ ok: false, error: '请求体不是有效的 JSON。' }, 400);
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return jsonResponse({ ok: false, error: '请求参数无效。' }, 400);
    }

    const {
        apiKey: rawApiKey,
        persist,
        enable
    } = payload as {
        apiKey?: unknown;
        persist?: unknown;
        enable?: unknown;
    };
    const apiKey = normalizeApiKey(rawApiKey);
    if (!apiKey) {
        return jsonResponse({ ok: false, error: 'API Key 不能为空，且长度不能超过 4096 个字符。' }, 400);
    }
    if (typeof persist !== 'boolean' || typeof enable !== 'boolean') {
        return jsonResponse({ ok: false, error: '请求参数 persist 和 enable 必须是布尔值。' }, 400);
    }

    setRuntimeApiConfig({ apiKey, enabled: enable });

    let persisted = false;
    let warning: string | undefined;
    if (persist) {
        try {
            await persistEnvLocal(apiKey, enable);
            persisted = true;
        } catch (error) {
            warning = 'API Key 已在本次运行中生效，但写入 .env.local 失败；重启后需要重新配置。';
            console.error('[local-config] 写入 .env.local 失败', {
                errorName: error instanceof Error ? error.name : typeof error,
                errorMessage: error instanceof Error ? error.message : String(error)
            });
        }
    }

    console.log('[local-config] API Key 配置成功', {
        source: 'runtime',
        persist,
        persisted,
        enabled: enable
    });

    return jsonResponse({
        ok: true,
        persisted,
        enabled: isImageApiEnabled(),
        apiKeyConfigured: hasOpenAiApiKey(),
        ...(warning ? { warning } : {})
    });
}
