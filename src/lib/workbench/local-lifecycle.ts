import net from 'node:net';

const globals = globalThis as typeof globalThis & {
    workbenchLocalLifecycle?: { activeRequests: number; stopping: boolean };
};
const lifecycle = (globals.workbenchLocalLifecycle ??= { activeRequests: 0, stopping: false });

export function canStopLocalService() {
    return !!(process.env.WORKBENCH_DESKTOP_PIPE && process.env.WORKBENCH_DESKTOP_STOP_TOKEN);
}

export function beginLocalRequest() {
    if (lifecycle.stopping) return null;
    lifecycle.activeRequests++;
    return () => {
        lifecycle.activeRequests--;
    };
}

export function reserveLocalStop(hasActiveRuns: () => boolean) {
    if (lifecycle.stopping || lifecycle.activeRequests > 0 || hasActiveRuns()) return false;
    lifecycle.stopping = true;
    return true;
}

export function cancelLocalStop() {
    lifecycle.stopping = false;
}

export function requestLocalStop() {
    return new Promise<void>((resolve, reject) => {
        const pipe = process.env.WORKBENCH_DESKTOP_PIPE!;
        const token = process.env.WORKBENCH_DESKTOP_STOP_TOKEN!;
        const socket = net.connect(pipe);
        let reply = '';
        socket.setTimeout(2500, () => socket.destroy(new Error('后台进程未响应。')));
        socket.once('connect', () => socket.write(`web-stop:${token}\n`));
        socket.on('data', (chunk) => { reply += chunk.toString(); });
        socket.once('error', reject);
        socket.once('close', () => reject(new Error('后台控制连接已关闭。')));
        socket.once('end', () => {
            if (reply === 'accepted') resolve();
            else reject(new Error('后台进程未接受停止指令。'));
        });
    });
}
