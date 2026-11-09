import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export type DownloadErrorCode =
    | 'INVALID_URL'
    | 'PRIVATE_ADDRESS'
    | 'UNSUPPORTED_PROTOCOL'
    | 'UNSUPPORTED_PORT'
    | 'TOO_MANY_REDIRECTS'
    | 'HTTP_ERROR'
    | 'NOT_IMAGE'
    | 'TOO_LARGE'
    | 'TIMEOUT'
    | 'FETCH_FAILED';

export class SafeDownloadError extends Error {
    readonly code: DownloadErrorCode;
    readonly status?: number;

    constructor(code: DownloadErrorCode, message: string, status?: number) {
        super(message);
        this.name = 'SafeDownloadError';
        this.code = code;
        this.status = status;
    }
}

export type SafeDownloadResult = {
    bytes: Buffer;
    mime: string;
    finalUrl: string;
    contentType: string;
};

type RequestResponse = {
    status: number;
    headers: http.IncomingHttpHeaders;
    bytes: Buffer;
    finalUrl: string;
};

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_REDIRECTS = 3;

function ipv4Parts(ip: string): number[] | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    const values = parts.map((part) => Number(part));
    return values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255) ? values : null;
}

function ipv4FromTail(tail: string): string | null {
    if (net.isIP(tail) === 4) return tail;
    const groups = tail.split(':').filter(Boolean);
    if (groups.length < 1 || groups.length > 2) return null;
    const values = groups.map((group) => parseInt(group, 16));
    if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff)) return null;
    const high = values.length === 2 ? values[0] : 0;
    const low = values.length === 2 ? values[1] : values[0];
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

function isLoopbackIp(ip: string): boolean {
    if (net.isIP(ip) === 4) {
        const parts = ipv4Parts(ip);
        return !!parts && parts[0] === 127;
    }
    const normalized = ip.toLowerCase();
    return normalized === '::1' || normalized === '0:0:0:0:0:0:0:1';
}

export function isBlockedIp(ip: string): boolean {
    const version = net.isIP(ip);
    if (version === 4) {
        const parts = ipv4Parts(ip);
        if (!parts) return true;
        const [a, b] = parts;
        if (a === 0 || a === 10 || a === 127) return true;
        if (a === 100 && b >= 64 && b <= 127) return true;
        if (a === 169 && b === 254) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 192 && b === 0) return true;
        if (a === 198 && (b === 18 || b === 19)) return true;
        if (a >= 224) return true;
        return false;
    }

    if (version === 6) {
        const normalized = ip.toLowerCase();
        if (normalized === '::' || normalized === '::1') return true;
        if (
            normalized.startsWith('fe8') ||
            normalized.startsWith('fe9') ||
            normalized.startsWith('fea') ||
            normalized.startsWith('feb')
        )
            return true;
        if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
        if (normalized.startsWith('ff')) return true;
        if (normalized.startsWith('2001:db8') || normalized.startsWith('2002:')) return true;
        if (normalized.startsWith('::ffff:')) {
            const mapped = ipv4FromTail(normalized.slice('::ffff:'.length));
            if (mapped) return isBlockedIp(mapped);
        }
        if (normalized.startsWith('64:ff9b:')) {
            const mapped = ipv4FromTail(normalized.split(':').slice(-2).join(':'));
            if (mapped) return isBlockedIp(mapped);
        }
        return false;
    }

    return true;
}

export async function validatePublicUrl(rawUrl: string, options?: { allowLoopback?: boolean }): Promise<URL> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new SafeDownloadError('INVALID_URL', 'URL 无法解析。');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new SafeDownloadError('UNSUPPORTED_PROTOCOL', `不支持的协议：${url.protocol}`);
    }
    if (url.username || url.password) {
        throw new SafeDownloadError('INVALID_URL', 'URL 不能包含账号或密码。');
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
        !hostname ||
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        hostname === 'metadata.google.internal' ||
        hostname === 'instance-data'
    ) {
        if (!(options?.allowLoopback && (hostname === 'localhost' || hostname.endsWith('.localhost')))) {
            throw new SafeDownloadError('PRIVATE_ADDRESS', '禁止访问本机或内部域名。');
        }
    }

    if (net.isIP(hostname)) {
        if (options?.allowLoopback && isLoopbackIp(hostname)) return url;
        if (isBlockedIp(hostname)) {
            throw new SafeDownloadError('PRIVATE_ADDRESS', `禁止访问私网/保留地址：${hostname}`);
        }
    }

    if (!ALLOWED_PORTS.has(url.port) && !options?.allowLoopback) {
        throw new SafeDownloadError('UNSUPPORTED_PORT', `不支持的端口：${url.port}`);
    }

    if (net.isIP(hostname)) return url;

    let addresses: { address: string; family: number }[];
    try {
        addresses = await dns.lookup(hostname, { all: true });
    } catch {
        throw new SafeDownloadError('FETCH_FAILED', `域名解析失败：${hostname}`);
    }
    if (addresses.length === 0) {
        throw new SafeDownloadError('FETCH_FAILED', `域名没有解析结果：${hostname}`);
    }
    for (const entry of addresses) {
        if (options?.allowLoopback && isLoopbackIp(entry.address)) continue;
        if (isBlockedIp(entry.address)) {
            throw new SafeDownloadError('PRIVATE_ADDRESS', `域名解析到私网/保留地址：${hostname} -> ${entry.address}`);
        }
    }
    return url;
}

function sniffImage(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
    if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
    ) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    if (
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return 'image/webp';
    }
    return null;
}

function requestOnce(
    url: URL,
    options: { timeoutMs: number; maxBytes: number; allowLoopback: boolean }
): Promise<RequestResponse> {
    return new Promise((resolve, reject) => {
        const transport = url.protocol === 'https:' ? https : http;
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        const literalIp = net.isIP(hostname);

        const lookup: net.LookupFunction | undefined = literalIp
            ? undefined
            : (host, _lookupOptions, callback) => {
                  dns.lookup(host, { all: true })
                      .then((addresses) => {
                          if (addresses.length === 0) {
                              callback(new SafeDownloadError('FETCH_FAILED', '域名没有解析结果。'), '', 4);
                              return;
                          }
                          for (const entry of addresses) {
                              if (options.allowLoopback && isLoopbackIp(entry.address)) continue;
                              if (isBlockedIp(entry.address)) {
                                  callback(
                                      new SafeDownloadError('PRIVATE_ADDRESS', 'DNS 在连接阶段解析到私网地址。'),
                                      '',
                                      4
                                  );
                                  return;
                              }
                          }
                          const chosen = addresses[0];
                          callback(null, chosen.address, chosen.family);
                      })
                      .catch(() => callback(new SafeDownloadError('FETCH_FAILED', '域名解析失败。'), '', 4));
              };

        const request = transport.request(
            {
                protocol: url.protocol,
                hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: `${url.pathname}${url.search}`,
                method: 'GET',
                headers: {
                    'user-agent': 'local-creative-workbench/1.0 (image reference import)',
                    accept: 'image/png,image/jpeg,image/webp;q=0.9,image/*;q=0.5',
                    'accept-language': 'zh-CN,zh;q=0.8,en;q=0.5'
                },
                ...(lookup ? { lookup } : {})
            },
            (response) => {
                const status = response.statusCode ?? 0;
                const headers = response.headers;
                if (status >= 300 && status < 400) {
                    response.resume();
                    resolve({ status, headers, bytes: Buffer.alloc(0), finalUrl: url.toString() });
                    return;
                }
                if (status < 200 || status >= 300) {
                    response.resume();
                    resolve({ status, headers, bytes: Buffer.alloc(0), finalUrl: url.toString() });
                    return;
                }

                const contentLength = Number(headers['content-length'] ?? '0');
                if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
                    response.destroy();
                    reject(new SafeDownloadError('TOO_LARGE', `文件超过 ${options.maxBytes} 字节限制。`));
                    return;
                }

                const chunks: Buffer[] = [];
                let total = 0;
                response.on('data', (chunk: Buffer) => {
                    total += chunk.length;
                    if (total > options.maxBytes) {
                        response.destroy();
                        reject(new SafeDownloadError('TOO_LARGE', `文件超过 ${options.maxBytes} 字节限制。`));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () => {
                    resolve({ status, headers, bytes: Buffer.concat(chunks), finalUrl: url.toString() });
                });
                response.on('error', (error) => {
                    reject(new SafeDownloadError('FETCH_FAILED', error.message));
                });
            }
        );

        request.setTimeout(options.timeoutMs, () => {
            request.destroy(new SafeDownloadError('TIMEOUT', `下载超时（${options.timeoutMs}ms）。`));
        });
        request.on('error', (error) => {
            if (error instanceof SafeDownloadError) {
                reject(error);
                return;
            }
            reject(new SafeDownloadError('FETCH_FAILED', error.message));
        });
        request.end();
    });
}

export async function safeDownloadImage(
    rawUrl: string,
    options?: {
        allowLoopback?: boolean;
        maxBytes?: number;
        timeoutMs?: number;
        maxRedirects?: number;
    }
): Promise<SafeDownloadResult> {
    const allowLoopback = options?.allowLoopback ?? false;
    const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRedirects = options?.maxRedirects ?? DEFAULT_REDIRECTS;

    let current = rawUrl;
    for (let redirect = 0; redirect <= maxRedirects; redirect++) {
        const url = await validatePublicUrl(current, { allowLoopback });
        const response = await requestOnce(url, { allowLoopback, maxBytes, timeoutMs });

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.location;
            if (!location) {
                throw new SafeDownloadError('HTTP_ERROR', '重定向响应缺少 Location。', response.status);
            }
            if (redirect === maxRedirects) {
                throw new SafeDownloadError('TOO_MANY_REDIRECTS', '重定向次数过多。');
            }
            current = new URL(location, url).toString();
            continue;
        }

        if (response.status < 200 || response.status >= 300) {
            throw new SafeDownloadError('HTTP_ERROR', `下载失败：HTTP ${response.status}。`, response.status);
        }

        const contentType = String(response.headers['content-type'] ?? '')
            .split(';')[0]
            .trim()
            .toLowerCase();
        if (contentType && !contentType.startsWith('image/')) {
            throw new SafeDownloadError('NOT_IMAGE', `返回内容不是图片：${contentType}`, response.status);
        }

        const sniffed = sniffImage(response.bytes);
        if (!sniffed) {
            throw new SafeDownloadError('NOT_IMAGE', '返回字节不是 PNG/JPEG/WEBP 图片。', response.status);
        }
        if (contentType === 'image/svg+xml' || contentType === 'image/gif') {
            throw new SafeDownloadError('NOT_IMAGE', `不支持的图片类型：${contentType}`, response.status);
        }

        return {
            bytes: response.bytes,
            mime: contentType.startsWith('image/') ? contentType : sniffed,
            finalUrl: response.finalUrl,
            contentType
        };
    }

    throw new SafeDownloadError('TOO_MANY_REDIRECTS', '重定向次数过多。');
}
