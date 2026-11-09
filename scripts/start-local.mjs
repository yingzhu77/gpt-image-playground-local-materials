import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createFixturePng } from './lib/png-fixture.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const envLocalPath = path.join(repoRoot, '.env.local');
const envExamplePath = path.join(repoRoot, '.env.local.example');
const preferredPort = 3000;

function print(message) {
    console.log(`[local] ${message}`);
}

function checkNodeVersion() {
    const major = Number(process.versions.node.split('.')[0]);
    if (!Number.isInteger(major) || major < 22) {
        print(`Node.js 版本过低：当前 ${process.versions.node}，需要 >=22。`);
        process.exit(1);
    }
}

function ensureEnvLocal() {
    if (fs.existsSync(envLocalPath)) return;
    fs.copyFileSync(envExamplePath, envLocalPath);
    print('未找到 .env.local，已从 .env.local.example 创建；请按需填写 OPENAI_API_KEY。');
}

function isPortFree(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}

async function findPort() {
    for (let port = preferredPort; port < 65535; port++) {
        if (await isPortFree(port)) return port;
    }
    throw new Error('没有找到可用端口。');
}

async function waitForPortFree(port, timeoutMs = 12000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (await isPortFree(port)) return true;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
}

function readEnvFlag(filePath, key) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const line = content.split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}=`));
        if (!line) return undefined;
        return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
    } catch {
        return undefined;
    }
}

const PROXY_KEYS = ['NODE_USE_ENV_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'];

function readProxyEnv() {
    const result = {};
    for (const key of PROXY_KEYS) {
        const value = readEnvFlag(envLocalPath, key) ?? process.env[key];
        if (value) result[key] = value;
    }
    if (!result.NODE_USE_ENV_PROXY && (result.HTTPS_PROXY || result.HTTP_PROXY || result.ALL_PROXY)) {
        result.NODE_USE_ENV_PROXY = '1';
    }
    return result;
}

function describeProxy(value) {
    if (!value) return '未配置';
    try {
        const parsed = new URL(value);
        return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
    } catch {
        return '已配置（地址无法解析）';
    }
}

checkNodeVersion();
ensureEnvLocal();

const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const apiSwitch = process.env.ENABLE_IMAGE_API ?? readEnvFlag(envLocalPath, 'ENABLE_IMAGE_API') ?? 'false';
const storageMode =
    process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE ?? readEnvFlag(envLocalPath, 'NEXT_PUBLIC_IMAGE_STORAGE_MODE') ?? 'fs';
const proxyEnv = readProxyEnv();
const proxyTarget = proxyEnv.HTTPS_PROXY || proxyEnv.HTTP_PROXY || proxyEnv.ALL_PROXY;
const configuredWorkbenchDataDir = process.env.WORKBENCH_DATA_DIR ?? readEnvFlag(envLocalPath, 'WORKBENCH_DATA_DIR');

const modeRuntimeDir = path.resolve(
    repoRoot,
    process.env.WORKBENCH_MODE_DIR ?? path.join('.workbench-data')
);
fs.mkdirSync(modeRuntimeDir, { recursive: true });
const modeRequestPath = path.join(modeRuntimeDir, 'mode-restart-request.json');
const modeHeartbeatPath = path.join(modeRuntimeDir, 'mode-watcher-heartbeat.json');
const MODE_REQUEST_TTL_MS = 120_000;

function dataDirFor(mode) {
    return path.resolve(
        repoRoot,
        configuredWorkbenchDataDir || (mode === 'mock' ? path.join('.workbench-data', 'mock') : '.workbench-data')
    );
}

function readWorkerToken(dataDir) {
    const fromEnv = process.env.WORKBENCH_WORKER_TOKEN?.trim();
    if (fromEnv) return fromEnv;
    const tokenPath = path.join(dataDir, 'worker-token');
    try {
        const existing = fs.readFileSync(tokenPath, 'utf8').trim();
        if (existing) return existing;
    } catch {
        // generate below
    }
    const token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
    return token;
}

function prepareMockRuntime(dataDir) {
    const fixtureDir = path.resolve(repoRoot, process.env.IMAGE_API_MOCK_FIXTURE_DIR ?? path.join(dataDir, 'fixtures'));
    const scenarioFile = path.resolve(
        repoRoot,
        process.env.IMAGE_API_MOCK_SCENARIO_FILE ?? path.join(dataDir, 'mock-scenario.json')
    );
    const mockLog = path.resolve(repoRoot, process.env.IMAGE_API_MOCK_LOG ?? path.join(dataDir, 'mock-calls.jsonl'));
    fs.mkdirSync(fixtureDir, { recursive: true });
    for (const [width, height] of [
        [2048, 1152],
        [1536, 864],
        [2048, 2048],
        [1024, 1024]
    ]) {
        const file = path.join(fixtureDir, `${width}x${height}.png`);
        if (!fs.existsSync(file)) fs.writeFileSync(file, createFixturePng(width, height));
    }
    const defaultFixture = path.join(fixtureDir, 'default.png');
    if (!fs.existsSync(defaultFixture)) fs.writeFileSync(defaultFixture, createFixturePng(2048, 1152));
    if (!fs.existsSync(scenarioFile)) {
        fs.writeFileSync(scenarioFile, `${JSON.stringify({ usage: 'present' }, null, 2)}\n`);
    }
    if (!fs.existsSync(mockLog)) fs.writeFileSync(mockLog, '');
    return { fixtureDir, scenarioFile, mockLog };
}

function buildWorkbenchEnv(mode, port) {
    const dataDir = dataDirFor(mode);
    fs.mkdirSync(dataDir, { recursive: true });
    const token = readWorkerToken(dataDir);
    const env = {
        ...proxyEnv,
        NEXT_TELEMETRY_DISABLED: '1',
        WORKBENCH_DATA_DIR: dataDir,
        WORKBENCH_MODE_DIR: modeRuntimeDir,
        WORKBENCH_WORKER_TOKEN: token,
        WORKBENCH_WORKER_URL: `http://127.0.0.1:${port}`,
        WORKBENCH_MOCK: mode === 'mock' ? '1' : '',
        IMAGE_API_MOCK_FIXTURE_DIR: '',
        IMAGE_API_MOCK_SCENARIO_FILE: '',
        IMAGE_API_MOCK_LOG: '',
        IMAGE_API_MOCK_UNIQUE: ''
    };
    let mockRuntime = null;
    if (mode === 'mock') {
        mockRuntime = prepareMockRuntime(dataDir);
        env.OPENAI_API_KEY = '';
        env.IMAGE_API_MOCK_FIXTURE_DIR = mockRuntime.fixtureDir;
        env.IMAGE_API_MOCK_SCENARIO_FILE = mockRuntime.scenarioFile;
        env.IMAGE_API_MOCK_LOG = mockRuntime.mockLog;
        env.IMAGE_API_MOCK_UNIQUE = '1';
    } else if (typeof process.env.OPENAI_API_KEY === 'string') {
        // Keep an explicitly provided shell key; otherwise let Next load .env.local.
        env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    }
    return { env, dataDir, token, mockRuntime };
}

function readModeRequest() {
    try {
        const parsed = JSON.parse(fs.readFileSync(modeRequestPath, 'utf8'));
        if (parsed?.mode !== 'mock' && parsed?.mode !== 'real') return null;
        if (typeof parsed.requestedAt !== 'number' || Date.now() - parsed.requestedAt > MODE_REQUEST_TTL_MS) return null;
        return parsed;
    } catch {
        return null;
    }
}

function consumeModeRequest() {
    const request = readModeRequest();
    if (!request) {
        if (fs.existsSync(modeRequestPath)) fs.rmSync(modeRequestPath, { force: true });
        return;
    }
    fs.rmSync(modeRequestPath, { force: true });
    if (request.mode !== currentMode) {
        void restartTo(request.mode);
    }
}

function resolveInitialMode() {
    const request = readModeRequest();
    if (request) {
        fs.rmSync(modeRequestPath, { force: true });
        return request.mode;
    }
    if (process.argv.includes('--mock')) return 'mock';
    if (process.argv.includes('--real')) return 'real';
    const envFlag = process.env.WORKBENCH_MOCK ?? readEnvFlag(envLocalPath, 'WORKBENCH_MOCK');
    if (envFlag !== undefined) return ['1', 'true'].includes(String(envFlag).toLowerCase()) ? 'mock' : 'real';
    return 'real';
}

const port = await findPort();
let currentMode = resolveInitialMode();
let currentChildren = null;
let restarting = false;
let shuttingDown = false;
let heartbeatTimer = null;
let watcherTimer = null;

function writeHeartbeat() {
    try {
        fs.writeFileSync(
            modeHeartbeatPath,
            `${JSON.stringify({ pid: process.pid, updatedAt: Date.now(), port, mode: currentMode })}\n`
        );
    } catch {
        // Heartbeat only enables the one-click switch; failure is non-fatal.
    }
}

function stopChild(child) {
    return new Promise((resolve) => {
        if (!child || child.exitCode !== null) {
            resolve();
            return;
        }
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        child.once('exit', done);
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
            child.kill('SIGTERM');
        }
        setTimeout(done, 5000);
    });
}

async function stopChildren() {
    if (!currentChildren) return;
    const session = currentChildren;
    currentChildren = null;
    session.stopping = true;
    await stopChild(session.worker);
    await stopChild(session.child);
}

function startChildren(mode) {
    const { env, dataDir, mockRuntime } = buildWorkbenchEnv(mode, port);
    currentMode = mode;

    print(`本地访问地址: http://127.0.0.1:${port}`);
    print(`模式: ${mode === 'mock' ? 'Mock（本地夹具，不调用真实 API）' : '真实（使用 .env.local 中的配置）'}`);
    print(`创作工作台: http://127.0.0.1:${port}/workbench（数据目录 ${path.relative(repoRoot, dataDir) || '.'}）`);
    print(`ENABLE_IMAGE_API=${apiSwitch}，图片存储模式=${storageMode}。`);
    if (proxyTarget) {
        print(`Node 代理: ${describeProxy(proxyTarget)}（NODE_USE_ENV_PROXY=${proxyEnv.NODE_USE_ENV_PROXY ?? 'unset'}）。`);
        if (Number(process.versions.node.split('.')[0]) < 24) {
            print('警告：当前 Node 版本可能不支持 NODE_USE_ENV_PROXY，代理可能不会生效。');
        }
    } else {
        print('Node 代理: 未配置，将直连。');
    }
    if (apiSwitch.toLowerCase() !== 'true') {
        print('生成服务当前未启用：页面可打开和调参，但提交会被服务端拒绝。');
    }
    if (mockRuntime) {
        print('Mock fixture 已准备；本次运行不读取真实 Key。');
        print(`Mock fixture: ${path.relative(repoRoot, mockRuntime.fixtureDir)}`);
    }
    print('停止：在此窗口按 Ctrl+C。切换模式：工作台右上角“切换模式”。');

    const child = spawn(
        process.execPath,
        [nextBin, 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', String(port)],
        { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, ...env } }
    );
    const worker = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'workbench-worker.mjs')], {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, ...env }
    });
    const session = { child, worker, mode, stopping: false };
    currentChildren = session;

    child.on('exit', (code, signal) => {
        if (session.stopping || shuttingDown) return;
        print(signal ? `开发服务器已停止（${signal}）。` : `开发服务器已退出（code ${code}）。`);
        if (!worker.killed) worker.kill('SIGTERM');
        process.exit(code ?? 0);
    });
    worker.on('exit', (code) => {
        if (session.stopping || shuttingDown) return;
        print(`工作台 worker 已退出（code ${code}）；Web 仍可打开，但任务不会继续执行。`);
    });
}

async function restartTo(mode) {
    if (restarting || shuttingDown || mode === currentMode) return;
    restarting = true;
    print(`收到模式切换请求：${currentMode} -> ${mode}，正在重启 Web 与 worker…`);
    await stopChildren();
    const free = await waitForPortFree(port);
    if (!free) print(`警告：端口 ${port} 尚未释放，重启可能失败。`);
    if (shuttingDown) {
        restarting = false;
        return;
    }
    restarting = false;
    startChildren(mode);
    writeHeartbeat();
    print(`模式切换完成：${mode}。`);
}

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (watcherTimer) clearInterval(watcherTimer);
    try {
        fs.rmSync(modeHeartbeatPath, { force: true });
    } catch {
        // ignore
    }
    print(`收到 ${signal}，正在停止 Web 与 worker…`);
    void stopChildren().finally(() => process.exit(0));
}

startChildren(currentMode);
writeHeartbeat();
heartbeatTimer = setInterval(writeHeartbeat, 2000);
watcherTimer = setInterval(consumeModeRequest, 700);

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
