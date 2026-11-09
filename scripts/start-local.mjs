import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

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

if (process.argv.includes('--mock') || ['1', 'true'].includes(String(process.env.WORKBENCH_MOCK ?? readEnvFlag(envLocalPath, 'WORKBENCH_MOCK') ?? '').toLowerCase())) {
    throw new Error('模拟运行模式已移除。请删除旧的 --mock / WORKBENCH_MOCK 开关后重新启动；本次未启动服务或发送请求。');
}

const dataDir = path.resolve(repoRoot, configuredWorkbenchDataDir || '.workbench-data');
fs.mkdirSync(dataDir, { recursive: true });

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

const port = await findPort();
const token = readWorkerToken(dataDir);
const env = {
    ...process.env,
    ...proxyEnv,
    NEXT_TELEMETRY_DISABLED: '1',
    WORKBENCH_DATA_DIR: dataDir,
    WORKBENCH_WORKER_TOKEN: token,
    WORKBENCH_WORKER_URL: `http://127.0.0.1:${port}`,
    // The ordinary launcher never enables an internal test provider.
    WORKBENCH_TEST_FIXTURES: '',
    WORKBENCH_TEST_STRICT_AUTHORIZATION: '',
    WORKBENCH_TEST_SCENARIO_FILE: '',
    IMAGE_API_TEST_FIXTURE_DIR: '',
    IMAGE_API_TEST_SCENARIO_FILE: '',
    IMAGE_API_TEST_LOG: '',
    IMAGE_API_TEST_UNIQUE: ''
};

print(`本地访问地址: http://127.0.0.1:${port}`);
print(`创作工作台: http://127.0.0.1:${port}/workbench（数据目录 ${path.relative(repoRoot, dataDir) || '.'}）`);
print(`ENABLE_IMAGE_API=${apiSwitch}，图片存储模式=${storageMode}。`);
if (proxyTarget) {
    print(`Node 代理: ${describeProxy(proxyTarget)}（NODE_USE_ENV_PROXY=${proxyEnv.NODE_USE_ENV_PROXY ?? 'unset'}）。`);
    if (Number(process.versions.node.split('.')[0]) < 24) {
        print('警告：当前 Node 版本可能不支持 NODE_USE_ENV_PROXY，代理可能不会生效。');
    }
} else print('Node 代理: 未配置，将直连。');
if (apiSwitch.toLowerCase() !== 'true') print('生成服务当前未启用：页面可打开和调参，但提交会被服务端拒绝。');
print('模型操作使用真实 API，执行前仍需确认费用与调用范围。停止：在此窗口按 Ctrl+C。');

const child = spawn(process.execPath, [nextBin, 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: repoRoot, stdio: 'inherit', env });
const worker = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'workbench-worker.mjs')], { cwd: repoRoot, stdio: 'inherit', env });
let shuttingDown = false;

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

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    print(`收到 ${signal}，正在停止 Web 与 worker…`);
    void (async () => {
        await stopChild(worker);
        await stopChild(child);
        process.exit(0);
    })();
}
child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    print(signal ? `开发服务器已停止（${signal}）。` : `开发服务器已退出（code ${code}）。`);
    if (!worker.killed) worker.kill('SIGTERM');
    process.exit(code ?? 0);
});
worker.on('exit', (code) => {
    if (!shuttingDown) print(`工作台 worker 已退出（code ${code}）；Web 仍可打开，但任务不会继续执行。`);
});
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
