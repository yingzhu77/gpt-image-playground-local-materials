import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

const port = await findPort();
const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const apiSwitch =
    process.env.ENABLE_IMAGE_API ?? readEnvFlag(envLocalPath, 'ENABLE_IMAGE_API') ?? 'false';
const storageMode =
    process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE ??
    readEnvFlag(envLocalPath, 'NEXT_PUBLIC_IMAGE_STORAGE_MODE') ??
    'fs';
const proxyEnv = readProxyEnv();
const proxyTarget = proxyEnv.HTTPS_PROXY || proxyEnv.HTTP_PROXY || proxyEnv.ALL_PROXY;

print(`本地访问地址: http://127.0.0.1:${port}`);
if (port !== preferredPort) {
    print(`端口 ${preferredPort} 已被占用，已自动改用 ${port}（未结束其他进程）。`);
}
print(`ENABLE_IMAGE_API=${apiSwitch}，图片存储模式=${storageMode}。`);
if (proxyTarget) {
    print(
        `Node 代理: ${describeProxy(proxyTarget)}（NODE_USE_ENV_PROXY=${proxyEnv.NODE_USE_ENV_PROXY ?? 'unset'}）。`
    );
    if (Number(process.versions.node.split('.')[0]) < 24) {
        print('警告：当前 Node 版本可能不支持 NODE_USE_ENV_PROXY，代理可能不会生效。');
    }
} else {
    print('Node 代理: 未配置，将直连。');
}
if (apiSwitch.toLowerCase() !== 'true') {
    print('生成服务当前未启用：页面可打开和调参，但提交会被服务端拒绝。');
}
print('停止：在此窗口按 Ctrl+C。再次启动：双击 start-local.cmd。');

const child = spawn(process.execPath, [nextBin, 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...proxyEnv, NEXT_TELEMETRY_DISABLED: '1' }
});

child.on('exit', (code, signal) => {
    if (signal) {
        print(`开发服务器已停止（${signal}）。`);
    } else {
        print(`开发服务器已退出（code ${code}）。`);
    }
    process.exit(code ?? 0);
});

process.on('SIGINT', () => {
    child.kill('SIGINT');
});
process.on('SIGTERM', () => {
    child.kill('SIGTERM');
});
