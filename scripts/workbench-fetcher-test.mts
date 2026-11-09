import http from 'node:http';
import { createFixturePng } from './lib/png-fixture.mjs';
import { isBlockedIp, safeDownloadImage, SafeDownloadError, validatePublicUrl } from '../src/lib/workbench/fetcher.ts';

const passed = [];
const failed = [];

function check(name, condition, detail) {
    if (condition) {
        passed.push(name);
        console.log(`PASS  ${name}`);
    } else {
        failed.push(`${name}${detail ? `: ${detail}` : ''}`);
        console.error(`FAIL  ${name}${detail ? `: ${detail}` : ''}`);
    }
}

async function expectError(name, fn, code) {
    try {
        await fn();
        check(name, false, `expected ${code}, got success`);
    } catch (error) {
        check(name, error instanceof SafeDownloadError && error.code === code, error instanceof Error ? `${error.name} ${error.message}` : String(error));
    }
}

const png = createFixturePng(64, 64);
const server = http.createServer((request, response) => {
    if (request.url === '/ok.png') {
        response.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length });
        response.end(png);
        return;
    }
    if (request.url === '/403') {
        response.writeHead(403, { 'content-type': 'text/plain' });
        response.end('forbidden');
        return;
    }
    if (request.url === '/html') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<html><body>not an image</body></html>');
        return;
    }
    if (request.url === '/huge') {
        response.writeHead(200, { 'content-type': 'image/png', 'content-length': '999999999' });
        response.end();
        return;
    }
    if (request.url === '/redirect-private') {
        response.writeHead(302, { location: 'http://10.0.0.1/metadata.png' });
        response.end();
        return;
    }
    if (request.url === '/redirect-local') {
        response.writeHead(302, { location: `http://127.0.0.1:${address.port}/ok.png` });
        response.end();
        return;
    }
    response.writeHead(404);
    response.end();
});

const address = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
});
const base = `http://127.0.0.1:${address.port}`;

check('block 127.0.0.1', isBlockedIp('127.0.0.1'));
check('block 10.0.0.1', isBlockedIp('10.0.0.1'));
check('block 172.16.0.1', isBlockedIp('172.16.0.1'));
check('block 192.168.1.1', isBlockedIp('192.168.1.1'));
check('block 169.254.169.254', isBlockedIp('169.254.169.254'));
check('block 100.64.0.1', isBlockedIp('100.64.0.1'));
check('block ::1', isBlockedIp('::1'));
check('block fc00::1', isBlockedIp('fc00::1'));
check('block ::ffff:127.0.0.1', isBlockedIp('::ffff:127.0.0.1'));
check('block 2001:db8::1', isBlockedIp('2001:db8::1'));
check('allow public 93.184.216.34', !isBlockedIp('93.184.216.34'));

await expectError('reject file protocol', () => validatePublicUrl('file:///etc/passwd'), 'UNSUPPORTED_PROTOCOL');
await expectError('reject loopback URL by default', () => validatePublicUrl(`${base}/ok.png`), 'PRIVATE_ADDRESS');
await expectError('reject metadata IP', () => validatePublicUrl('http://169.254.169.254/latest/meta-data'), 'PRIVATE_ADDRESS');
await expectError('reject disallowed port', () => validatePublicUrl('http://93.184.216.34:22/x.png'), 'UNSUPPORTED_PORT');
await expectError('reject credentials in URL', () => validatePublicUrl('http://user:pass@93.184.216.34/x.png'), 'INVALID_URL');

await expectError(
    'safeDownload blocks loopback without test flag',
    () => safeDownloadImage(`${base}/ok.png`),
    'PRIVATE_ADDRESS'
);

const ok = await safeDownloadImage(`${base}/ok.png`, { allowLoopback: true });
check('download valid PNG', ok.mime === 'image/png' && ok.bytes.length === png.length);
await expectError('download 403', () => safeDownloadImage(`${base}/403`, { allowLoopback: true }), 'HTTP_ERROR');
await expectError('download HTML 200', () => safeDownloadImage(`${base}/html`, { allowLoopback: true }), 'NOT_IMAGE');
await expectError('download oversize', () => safeDownloadImage(`${base}/huge`, { allowLoopback: true }), 'TOO_LARGE');
const redirected = await safeDownloadImage(`${base}/redirect-local`, { allowLoopback: true });
check('follow allowed redirect', redirected.bytes.length === png.length);
await expectError(
    'redirect to private is blocked',
    () => safeDownloadImage(`${base}/redirect-private`, { allowLoopback: true }),
    'PRIVATE_ADDRESS'
);

server.close();
console.log(`\nFetcher checks: PASS ${passed.length} / FAIL ${failed.length}`);
if (failed.length > 0) {
    for (const item of failed) console.log(`- ${item}`);
    process.exit(1);
}
