import fs from 'node:fs/promises';
import path from 'node:path';

export type ImageRequestMetadata = {
    localRequestId: string;
    runId?: string | null;
    itemId?: string | null;
    operation: 'generate' | 'edit';
    model: string;
    size?: string | null;
    quality?: string | null;
    n?: number | null;
    sdkTimeoutMs: number;
    maxRetries: 0;
};

export type ImageResponseDiagnostics = {
    upstreamRequestId?: string | null;
    httpStatus?: number | null;
};

type ErrorFingerprint = { name: string; code?: string; syscall?: string };

const ERROR_NAMES = new Set([
    'Error',
    'TypeError',
    'RangeError',
    'SystemError',
    'AggregateError',
    'AbortError',
    'TimeoutError',
    'APIError',
    'APIConnectionError',
    'APIConnectionTimeoutError',
    'APIUserAbortError',
    'BadRequestError',
    'AuthenticationError',
    'PermissionDeniedError',
    'NotFoundError',
    'ConflictError',
    'UnprocessableEntityError',
    'RateLimitError',
    'InternalServerError',
    'ImageStreamError',
    'SocketError',
    'ConnectTimeoutError',
    'HeadersTimeoutError',
    'BodyTimeoutError',
    'RequestAbortedError',
    'ResponseContentLengthMismatchError',
    'RequestContentLengthMismatchError',
    'ClientClosedError',
    'ClientDestroyedError'
]);
const ERROR_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'EPIPE',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EADDRNOTAVAIL',
    'ABORT_ERR',
    'ERR_CANCELED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'ERR_SSL_WRONG_VERSION_NUMBER',
    'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE',
    'ERR_HTTP2_STREAM_CANCEL',
    'ERR_HTTP2_GOAWAY_SESSION',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_SOCKET',
    'UND_ERR_ABORTED',
    'UND_ERR_CONNECT',
    'UND_ERR_DESTROYED',
    'UND_ERR_CLOSED',
    'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
    'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH',
    'UND_ERR_RESPONSE_STATUS_CODE',
    'ENOENT',
    'EACCES',
    'EPERM',
    'ENOSPC',
    'EIO',
    'ENAMETOOLONG',
    'EROFS',
    'EMFILE',
    'ENFILE',
    'EBUSY',
    'EEXIST'
]);
const SYSCALLS = new Set([
    'connect',
    'read',
    'write',
    'writev',
    'socket',
    'getaddrinfo',
    'lookup',
    'resolve',
    'send',
    'recv',
    'open',
    'mkdir',
    'stat',
    'appendFile'
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^req_[a-zA-Z0-9]{8,128}$/;

function field(value: unknown, key: string): unknown {
    try {
        return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
    } catch {
        return undefined;
    }
}

function uuid(value: unknown): string | null {
    return typeof value === 'string' && UUID.test(value) ? value : null;
}

function requestId(value: unknown): string | null {
    return typeof value === 'string' && REQUEST_ID.test(value) ? value : null;
}

function httpStatus(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function fingerprint(error: unknown): ErrorFingerprint {
    const name = field(error, 'name');
    const code = field(error, 'code');
    const syscall = field(error, 'syscall');
    return {
        name: typeof name === 'string' && ERROR_NAMES.has(name) ? name : 'OtherError',
        ...(typeof code === 'string' && ERROR_CODES.has(code) ? { code } : {}),
        ...(typeof syscall === 'string' && SYSCALLS.has(syscall) ? { syscall } : {})
    };
}

function errorChain(error: unknown): ErrorFingerprint[] {
    const chain: ErrorFingerprint[] = [];
    const seen = new Set<unknown>();
    let current = error;
    while (current && typeof current === 'object' && !seen.has(current) && chain.length < 5) {
        seen.add(current);
        chain.push(fingerprint(current));
        current = field(current, 'cause');
    }
    return chain;
}

function warn(category: string, error: unknown) {
    try {
        console.warn('[image-request-audit]', { category, ...fingerprint(error) });
    } catch {
        // A diagnostic sink must never replace an image request's result or exception.
    }
}

async function persistEvent(event: Record<string, unknown>) {
    try {
        const directory = path.resolve(
            /*turbopackIgnore: true*/ process.cwd(),
            process.env.WORKBENCH_DATA_DIR?.trim() || '.workbench-data'
        );
        await fs.mkdir(directory, { recursive: true });
        await fs.appendFile(
            path.join(/*turbopackIgnore: true*/ directory, 'image-request-events.jsonl'),
            `${JSON.stringify(event)}\n`,
            'utf8'
        );
    } catch (error) {
        warn('AUDIT_WRITE_FAILED', error);
    }
}

/** Persists only diagnostic metadata; prompts, bodies, headers and raw error messages are never logged. */
export async function auditImageRequest<T>(
    metadata: ImageRequestMetadata,
    operation: () => Promise<T>,
    describeSuccess?: (value: T) => ImageResponseDiagnostics,
    describeFailure?: () => ImageResponseDiagnostics
): Promise<T> {
    const started = performance.now();
    const common = {
        schemaVersion: 1,
        localRequestId: uuid(metadata.localRequestId),
        runId: uuid(metadata.runId),
        itemId: uuid(metadata.itemId),
        operation: metadata.operation === 'edit' ? 'edit' : 'generate',
        model: /^gpt-image-[a-zA-Z0-9.-]{1,80}$/.test(metadata.model) ? metadata.model : null,
        size:
            typeof metadata.size === 'string' && /^(auto|custom|\d{2,5}x\d{2,5})$/.test(metadata.size)
                ? metadata.size
                : null,
        quality: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(metadata.quality ?? '')
            ? metadata.quality
            : null,
        n: Number.isInteger(metadata.n) && metadata.n! >= 1 && metadata.n! <= 16 ? metadata.n : null,
        sdkTimeoutMs:
            Number.isFinite(metadata.sdkTimeoutMs) && metadata.sdkTimeoutMs >= 0 ? metadata.sdkTimeoutMs : null,
        maxRetries: 0
    };
    await persistEvent({ ...common, event: 'start', timestamp: new Date().toISOString(), elapsedMs: 0 });

    let value: T;
    try {
        value = await operation();
    } catch (error) {
        let response: ImageResponseDiagnostics = {};
        try {
            response = describeFailure?.() ?? {};
        } catch (mappingError) {
            warn('AUDIT_ERROR_MAPPING_FAILED', mappingError);
        }
        await persistEvent({
            ...common,
            event: 'error',
            timestamp: new Date().toISOString(),
            elapsedMs: Math.round(performance.now() - started),
            upstreamRequestId:
                requestId(field(error, 'request_id')) ??
                requestId(field(error, 'requestID')) ??
                requestId(response.upstreamRequestId),
            httpStatus: httpStatus(field(error, 'status')) ?? httpStatus(response.httpStatus),
            errorChain: errorChain(error)
        });
        throw error;
    }

    let response: ImageResponseDiagnostics = {};
    try {
        response = describeSuccess?.(value) ?? {};
    } catch (error) {
        warn('AUDIT_RESPONSE_MAPPING_FAILED', error);
    }
    await persistEvent({
        ...common,
        event: 'success',
        timestamp: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - started),
        upstreamRequestId: requestId(response.upstreamRequestId),
        httpStatus: httpStatus(response.httpStatus)
    });
    return value;
}
