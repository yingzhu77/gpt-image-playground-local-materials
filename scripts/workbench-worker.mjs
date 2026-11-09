import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
if (['1', 'true'].includes(String(process.env.WORKBENCH_MOCK ?? '').toLowerCase())) {
    throw new Error('模拟运行模式已移除；请移除 WORKBENCH_MOCK 后重新启动，未发送任务请求。');
}
const configuredDataDir = process.env.WORKBENCH_DATA_DIR?.trim();
const dataDir = path.resolve(
    repoRoot,
    configuredDataDir || '.workbench-data'
);
const tokenPath = path.join(dataDir, 'worker-token');
const baseUrl = (process.env.WORKBENCH_WORKER_URL || `http://127.0.0.1:${process.env.WORKBENCH_PORT || '3000'}`).replace(
    /\/$/,
    ''
);
const idleMs = Math.max(200, Number(process.env.WORKBENCH_WORKER_INTERVAL_MS || '1000'));
const requestTimeoutMs = Math.max(60_000, Number(process.env.WORKBENCH_WORKER_REQUEST_TIMEOUT_MS || '900000'));

function log(message, extra) {
    const line = `[workbench-worker ${new Date().toISOString()}] ${message}`;
    if (extra) console.log(line, extra);
    else console.log(line);
}

function readToken() {
    const fromEnv = process.env.WORKBENCH_WORKER_TOKEN?.trim();
    if (fromEnv) return fromEnv;
    try {
        return fs.readFileSync(tokenPath, 'utf8').trim() || null;
    } catch {
        return null;
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let stopping = false;
let controller = null;

function stop(signal) {
    if (stopping) return;
    stopping = true;
    log(`收到 ${signal}，准备停止（不取消已发送的上游请求，晚到结果仍会由服务端保存）。`);
    controller?.abort();
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

async function call(pathname, token) {
    controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
        const response = await fetch(`${baseUrl}${pathname}`, {
            method: 'POST',
            headers: { 'x-worker-token': token, 'content-type': 'application/json' },
            body: '{}',
            signal: controller.signal
        });
        const text = await response.text();
        let body = null;
        try {
            body = text ? JSON.parse(text) : null;
        } catch {
            body = null;
        }
        return { status: response.status, body, text };
    } finally {
        clearTimeout(timer);
        controller = null;
    }
}

async function waitForToken() {
    for (let attempt = 0; attempt < 120; attempt++) {
        const token = readToken();
        if (token) return token;
        await sleep(500);
    }
    throw new Error(`未能读取 worker token：${tokenPath}`);
}

async function recover(token) {
    for (let attempt = 0; attempt < 120; attempt++) {
        try {
            const result = await call('/api/workbench/internal/recover', token);
            if (result.status === 200) {
                log('启动恢复完成', { recovered: result.body?.recovered ?? 0 });
                return;
            }
            if (result.status === 401 || result.status === 403) {
                throw new Error(`worker token 被拒绝：HTTP ${result.status}`);
            }
            log(`服务尚未就绪（HTTP ${result.status}），稍后重试`);
        } catch (error) {
            if (stopping) return;
            log(`等待工作台服务：${error instanceof Error ? error.message : String(error)}`);
        }
        await sleep(1000);
    }
    throw new Error('工作台服务长时间不可用，worker 退出。');
}

async function main() {
    const token = await waitForToken();
    log('worker 已启动', { url: baseUrl, dataDir, tokenSource: process.env.WORKBENCH_WORKER_TOKEN ? 'env' : 'file' });
    await recover(token);
    if (stopping) return;

    while (!stopping) {
        try {
            const result = await call('/api/workbench/internal/tick', token);
            if (result.status === 401 || result.status === 403) {
                throw new Error(`worker token 被拒绝：HTTP ${result.status}`);
            }
            if (result.status !== 200) {
                log(`tick 失败 HTTP ${result.status}`, { body: result.text.slice(0, 300) });
                await sleep(idleMs);
                continue;
            }
            if (result.body?.didWork) {
                log('完成一步', {
                    runId: typeof result.body.runId === 'string' ? result.body.runId.slice(0, 8) : null,
                    kind: result.body.kind ?? null,
                    outcome: result.body.outcome ?? null,
                    status: result.body.status ?? null
                });
                continue;
            }
            await sleep(idleMs);
        } catch (error) {
            if (stopping) break;
            log(`tick 异常：${error instanceof Error ? error.message : String(error)}`);
            await sleep(Math.max(idleMs, 2000));
        }
    }
    log('worker 已停止');
}

main().catch((error) => {
    console.error(`[workbench-worker] 致命错误：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
