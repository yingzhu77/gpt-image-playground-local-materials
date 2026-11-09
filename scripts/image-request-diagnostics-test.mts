import { auditImageRequest, type ImageRequestMetadata } from '../src/lib/server/image-request-diagnostics.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const artifacts = path.resolve('test-artifacts/unknown-investigation');
await fs.mkdir(artifacts, { recursive: true });
const directory = await fs.mkdtemp(path.join(artifacts, 'diagnostics-test-'));
const previousDataDir = process.env.WORKBENCH_DATA_DIR;
const originalWarn = console.warn;
const warnings: unknown[][] = [];
const secret = 'sk-anonymous-do-not-log-secret';
const metadata: ImageRequestMetadata = {
    localRequestId: '11111111-1111-4111-8111-111111111111',
    runId: '22222222-2222-4222-8222-222222222222',
    itemId: '33333333-3333-4333-8333-333333333333',
    operation: 'generate',
    model: 'gpt-image-2.6-sunburst',
    size: '2048x1152',
    quality: 'high',
    n: 1,
    sdkTimeoutMs: 600_000,
    maxRetries: 0
};

async function records() {
    return (await fs.readFile(path.join(directory, 'image-request-events.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
}

try {
    process.env.WORKBENCH_DATA_DIR = directory;
    console.warn = (...args: unknown[]) => {
        warnings.push(args);
    };
    const expected = { data: { anonymous: true } };
    let calls = 0;
    const actual = await auditImageRequest(
        metadata,
        async () => {
            calls++;
            return expected;
        },
        () => ({
            httpStatus: 200,
            upstreamRequestId: 'req_12345678abcdefghijklmnop'
        })
    );
    assert.equal(actual, expected, 'Success returns the original object');
    assert.equal(calls, 1, 'Success is invoked once');
    let log = await records();
    assert.deepEqual(
        log.map((entry) => entry.event),
        ['start', 'success']
    );
    assert.equal(log[1].httpStatus, 200);
    assert.equal(log[1].upstreamRequestId, 'req_12345678abcdefghijklmnop');
    assert.equal(log[0].localRequestId, metadata.localRequestId);
    assert.equal(log[1].maxRetries, 0);

    const socket = Object.assign(new Error(secret), { name: 'SocketError', code: 'UND_ERR_SOCKET', syscall: 'read' });
    const transport = new TypeError(secret, { cause: socket });
    const original = Object.assign(new Error(secret, { cause: transport }), {
        name: 'APIConnectionError',
        status: 502,
        requestID: 'req_abcdefgh12345678',
        headers: { Authorization: secret },
        body: secret
    });
    calls = 0;
    await assert.rejects(
        auditImageRequest(metadata, async () => {
            calls++;
            throw original;
        }),
        (error) => error === original
    );
    assert.equal(calls, 1, 'A failed image request is never retried');
    log = await records();
    assert.equal(log.at(-1).event, 'error');
    assert.equal(log.at(-1).upstreamRequestId, 'req_abcdefgh12345678');
    assert.equal(log.at(-1).httpStatus, 502);
    assert.deepEqual(log.at(-1).errorChain, [
        { name: 'APIConnectionError' },
        { name: 'TypeError' },
        { name: 'SocketError', code: 'UND_ERR_SOCKET', syscall: 'read' }
    ]);

    const streamError = Object.assign(new Error(secret), { name: 'ImageStreamError', cause: socket });
    await assert.rejects(
        auditImageRequest(
            { ...metadata, operation: 'edit' },
            async () => {
                throw streamError;
            },
            undefined,
            () => ({ httpStatus: 200, upstreamRequestId: 'req_stream12345678' })
        ),
        (error) => error === streamError
    );
    log = await records();
    assert.equal(log.at(-1).httpStatus, 200, 'A stream failure retains the already received HTTP status');
    assert.equal(log.at(-1).upstreamRequestId, 'req_stream12345678');
    assert.equal('status' in streamError, false, 'Diagnostic status never changes business error classification');

    const malicious = Object.assign(new Error(secret), { name: secret, code: secret, syscall: secret, cause: null });
    malicious.cause = malicious as never;
    const extraMetadata = { ...metadata, prompt: secret, apiKey: secret, body: secret };
    await assert.rejects(
        auditImageRequest(extraMetadata, async () => {
            throw malicious;
        }),
        (error) => error === malicious
    );
    log = await records();
    assert.deepEqual(
        log.at(-1).errorChain,
        [{ name: 'OtherError' }],
        'Unknown names/codes/syscalls and cyclic causes are bounded'
    );
    assert(!JSON.stringify(log).includes(secret), 'Messages, headers, bodies and extra metadata never reach the log');
    assert(!JSON.stringify(log).includes('Authorization'));

    const mapped = await auditImageRequest(
        metadata,
        async () => expected,
        () => {
            throw new Error(secret);
        }
    );
    assert.equal(mapped, expected, 'A failed metadata mapper never replaces the result');
    assert.equal((await records()).at(-1).event, 'success');

    const blockedPath = path.join(directory, 'not-a-directory');
    await fs.writeFile(blockedPath, secret);
    process.env.WORKBENCH_DATA_DIR = blockedPath;
    assert.equal(await auditImageRequest(metadata, async () => expected), expected, 'Log failure preserves success');
    await assert.rejects(
        auditImageRequest(metadata, async () => {
            throw original;
        }),
        (error) => error === original,
        'Log failure preserves the original exception'
    );
    assert(warnings.some((entry) => JSON.stringify(entry).includes('AUDIT_WRITE_FAILED')));
    assert(warnings.some((entry) => JSON.stringify(entry).includes('AUDIT_RESPONSE_MAPPING_FAILED')));
    assert(!JSON.stringify(warnings).includes(secret), 'Fallback warnings are also redacted');
    console.log(
        'PASS image request audit: original result/error preserved; no retries; causes retained; secrets excluded; log failures isolated.'
    );
    console.log(`Artifacts: ${path.relative(process.cwd(), directory)}`);
} finally {
    console.warn = originalWarn;
    if (previousDataDir === undefined) delete process.env.WORKBENCH_DATA_DIR;
    else process.env.WORKBENCH_DATA_DIR = previousDataDir;
}
