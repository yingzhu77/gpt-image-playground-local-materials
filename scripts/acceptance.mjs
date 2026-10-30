import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createFixturePng, sha256 } from './lib/png-fixture.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const artifactsDir = path.join(repoRoot, 'test-artifacts');
const fixtureDir = path.join(artifactsDir, 'fixtures');
const outputDir = path.join(artifactsDir, 'mock-images');
const scenarioFile = path.join(artifactsDir, 'scenario.json');
const mockLog = path.join(artifactsDir, 'mock-calls.jsonl');
const serverLogsDir = path.join(artifactsDir, 'server-logs');
const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');

const passed = [];
const failed = [];

function check(name, condition, detail) {
    if (condition) {
        passed.push(name);
        console.log(`PASS  ${name}`);
    } else {
        failed.push({ name, detail });
        console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`);
    }
}

function checkEqual(name, actual, expected, extra) {
    check(
        name,
        JSON.stringify(actual) === JSON.stringify(expected),
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${extra ? ` (${extra})` : ''}`
    );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureArtifacts() {
    await fs.rm(artifactsDir, { recursive: true, force: true });
    await fs.mkdir(fixtureDir, { recursive: true });
    await fs.mkdir(serverLogsDir, { recursive: true });
}

async function createFixtures() {
    const base = createFixturePng(1024, 1024);
    const transparent = createFixturePng(1024, 1024, { alpha: true });
    const wide2k = createFixturePng(2048, 1152);
    const wideDraft = createFixturePng(1536, 864);
    const sourceA = createFixturePng(1024, 1024, {
        pixel: (x, y) => [Math.floor((255 * x) / 1024), 60, 60, 255]
    });
    const sourceB = createFixturePng(1024, 1024, {
        pixel: (x, y) => [60, Math.floor((255 * y) / 1024), 180, 255]
    });
    const mask = createFixturePng(1024, 1024, {
        alpha: true,
        pixel: (x, y) => {
            const dx = x - 512;
            const dy = y - 512;
            return dx * dx + dy * dy < 280 * 280 ? [0, 0, 0, 0] : [0, 0, 0, 255];
        }
    });
    const sourceLarge = createFixturePng(1536, 864);

    await fs.writeFile(path.join(fixtureDir, '1024x1024.png'), base);
    await fs.writeFile(path.join(fixtureDir, '1024x1024_transparent.png'), transparent);
    await fs.writeFile(path.join(fixtureDir, '2048x1152.png'), wide2k);
    await fs.writeFile(path.join(fixtureDir, '1536x864.png'), wideDraft);
    await fs.writeFile(path.join(fixtureDir, 'source-a.png'), sourceA);
    await fs.writeFile(path.join(fixtureDir, 'source-b.png'), sourceB);
    await fs.writeFile(path.join(fixtureDir, 'source-large.png'), sourceLarge);
    await fs.writeFile(path.join(fixtureDir, 'mask.png'), mask);
    await fs.writeFile(path.join(fixtureDir, 'default.png'), base);
    await setScenario({ usage: 'present' });

    return {
        baseHash: sha256(base),
        transparentHash: sha256(transparent),
        wide2kHash: sha256(wide2k),
        wideDraftHash: sha256(wideDraft)
    };
}

async function isPortFree(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}

async function findFreePort(start) {
    for (let port = start; port < start + 100; port++) {
        if (await isPortFree(port)) return port;
    }
    throw new Error(`No free port starting at ${start}.`);
}

async function waitForServer(url, timeoutMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
            if (response.ok) return;
        } catch {
            // Server is still compiling or starting.
        }
        await sleep(500);
    }
    throw new Error(`Server did not become ready at ${url}.`);
}

function serverConfig(name, port, env, output) {
    return {
        name,
        port,
        output,
        env: {
            NODE_ENV: 'development',
            OPENAI_API_KEY: '',
            OPENAI_API_BASE_URL: '',
            APP_PASSWORD: '',
            NEXT_PUBLIC_IMAGE_STORAGE_MODE: 'fs',
            NEXT_TELEMETRY_DISABLED: '1',
            ...env
        }
    };
}

async function startServer(config) {
    const logPath = path.join(serverLogsDir, `${config.name}.log`);
    const logFd = fsSync.openSync(logPath, 'a');
    const child = spawn(
        process.execPath,
        [nextBin, 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', String(config.port)],
        {
            cwd: repoRoot,
            env: { ...process.env, ...config.env },
            stdio: ['ignore', logFd, logFd]
        }
    );

    const session = { config, child, logFd, logPath, url: `http://127.0.0.1:${config.port}` };
    session.exited = new Promise((resolve) => child.once('exit', resolve));

    try {
        await waitForServer(`${session.url}/api/auth-status`);
    } catch (error) {
        const tail = await readTail(logPath);
        await stopServer(session);
        throw new Error(`${error.message}\n--- ${config.name} server log tail ---\n${tail}`);
    }

    return session;
}

async function stopServer(session) {
    if (!session) return;
    if (!session.child.killed) {
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(session.child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
            session.child.kill('SIGTERM');
        }
    }
    await Promise.race([session.exited, sleep(5000)]);
    try {
        fsSync.closeSync(session.logFd);
    } catch {
        // Already closed.
    }
    await sleep(500);
}

async function readTail(filePath, maxLines = 40) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return content.split(/\r?\n/).slice(-maxLines).join('\n');
    } catch {
        return '(no server log)';
    }
}

async function setScenario(scenario) {
    await fs.writeFile(scenarioFile, `${JSON.stringify(scenario, null, 2)}\n`);
}

async function resetMockLog() {
    await fs.writeFile(mockLog, '');
}

async function readMockLog() {
    try {
        const content = await fs.readFile(mockLog, 'utf8');
        return content
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    } catch {
        return [];
    }
}

async function buildForm({
    mode = 'generate',
    prompt,
    model = 'gpt-image-2.5-flare',
    n = 1,
    size = '1024x1024',
    quality = 'low',
    background = 'auto',
    format = 'png',
    references = [],
    mask,
    stream = false
}) {
    const formData = new FormData();
    formData.append('mode', mode);
    formData.append('prompt', prompt);
    formData.append('model', model);
    formData.append('n', String(n));
    formData.append('size', size);
    formData.append('quality', quality);
    formData.append('background', background);
    formData.append('output_format', format);
    formData.append('moderation', 'auto');
    if (stream) formData.append('stream', 'true');

    for (let index = 0; index < references.length; index++) {
        const filePath = references[index];
        const bytes = await fs.readFile(filePath);
        formData.append(
            `image_${index}`,
            new File([bytes], path.basename(filePath), { type: 'image/png' })
        );
    }
    if (mask) {
        const bytes = await fs.readFile(mask);
        formData.append('mask', new File([bytes], path.basename(mask), { type: 'image/png' }));
    }

    return formData;
}

async function postImages(baseUrl, options) {
    const formData = await buildForm(options);
    const response = await fetch(`${baseUrl}/api/images`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(120000)
    });
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        // Keep raw text for the assertion detail.
    }
    return { status: response.status, json, text };
}

async function readMetadata(json) {
    if (!json?.metadata_file) return null;
    const filePath = path.join(outputDir, ...json.metadata_file.split('/'));
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readOutputFile(json) {
    const filename = json?.images?.[0]?.filename;
    if (!filename) return null;
    return fs.readFile(path.join(outputDir, filename));
}

async function countOutputImages(dir = outputDir) {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return entries.filter((entry) => entry.isFile()).length;
    } catch {
        return 0;
    }
}

async function countMetadata(dir = outputDir) {
    try {
        const entries = await fs.readdir(path.join(dir, 'metadata'), { withFileTypes: true });
        return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).length;
    } catch {
        return 0;
    }
}

async function filesInTree(root, extension) {
    const result = [];
    async function walk(current) {
        let entries;
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (entry.name.endsWith(extension)) result.push(full);
        }
    }
    await walk(root);
    return result;
}

async function scanClientBundleForSecrets() {
    const staticDir = path.join(repoRoot, '.next', 'static');
    const files = await filesInTree(staticDir, '.js');
    const needles = ['process.env.OPENAI_API_KEY', 'Authorization: Bearer', 'sk-proj-', 'sk-svcacct-'];
    const hits = [];
    for (const file of files) {
        const content = await fs.readFile(file, 'utf8');
        for (const needle of needles) {
            if (content.includes(needle)) hits.push({ file: path.relative(repoRoot, file), needle });
        }
    }
    return { scannedFiles: files.length, hits };
}

async function main() {
    await ensureArtifacts();
    const fixtures = await createFixtures();

    const mockConfig = serverConfig(
        'mock',
        await findFreePort(3100),
        {
            ENABLE_IMAGE_API: 'true',
            IMAGE_API_MOCK_FIXTURE_DIR: fixtureDir,
            IMAGE_API_MOCK_SCENARIO_FILE: scenarioFile,
            IMAGE_API_MOCK_LOG: mockLog,
            IMAGE_OUTPUT_DIR: outputDir
        },
        outputDir
    );
    const disabledConfig = serverConfig(
        'disabled',
        await findFreePort(3110),
        {
            ENABLE_IMAGE_API: 'false',
            IMAGE_API_MOCK_FIXTURE_DIR: '',
            IMAGE_API_MOCK_SCENARIO_FILE: '',
            IMAGE_API_MOCK_LOG: '',
            IMAGE_OUTPUT_DIR: path.join(artifactsDir, 'disabled-images')
        },
        path.join(artifactsDir, 'disabled-images')
    );
    const keyMissingConfig = serverConfig(
        'key-missing',
        await findFreePort(3120),
        {
            ENABLE_IMAGE_API: 'true',
            IMAGE_API_MOCK_FIXTURE_DIR: '',
            IMAGE_API_MOCK_SCENARIO_FILE: '',
            IMAGE_API_MOCK_LOG: '',
            IMAGE_OUTPUT_DIR: path.join(artifactsDir, 'key-missing-images')
        },
        path.join(artifactsDir, 'key-missing-images')
    );

    const promptMarker = `LOCAL_ACCEPTANCE_PROMPT_MARKER_${Date.now()}`;
    let mockSession;

    try {
        mockSession = await startServer(mockConfig);
        const baseUrl = mockSession.url;

        // 1. Basic generate, original bytes, metadata and logging.
        await setScenario({ usage: 'present', requestId: 'mock_upstream_abc123' });
        await resetMockLog();
        let metadataBefore = await countMetadata();
        let imagesBefore = await countOutputImages();
        let response = await postImages(baseUrl, {
            prompt: promptMarker,
            size: '1024x1024',
            quality: 'low',
            background: 'auto',
            format: 'png'
        });
        let logEntries = await readMockLog();
        let metadata = await readMetadata(response.json);
        let outputBytes = await readOutputFile(response.json);

        check('generate 1024x1024 returns 200', response.status === 200, response.text);
        check('generate response is marked as mock', response.json?.mock === true, response.text);
        check('generate response includes usage', !!response.json?.usage && response.json.usage_missing === false, response.text);
        check('generate response width is 1024', response.json?.images?.[0]?.width === 1024, response.text);
        check('generate response height is 1024', response.json?.images?.[0]?.height === 1024, response.text);
        check('generate response has local request id', typeof response.json?.request_id === 'string', response.text);
        check(
            'upstream request id is captured separately',
            response.json?.openai_request_id === 'mock_upstream_abc123' &&
                response.json?.request_id !== response.json?.openai_request_id,
            response.text
        );
        check('mock log has exactly one call', logEntries.length === 1, `got ${logEntries.length}`);
        check('mock log preserves exact prompt', logEntries[0]?.prompt === promptMarker);
        check('mock log preserves model', logEntries[0]?.model === 'gpt-image-2.5-flare');
        check('mock log preserves size', logEntries[0]?.size === '1024x1024');
        check('mock log preserves quality', logEntries[0]?.quality === 'low');
        check('mock log preserves n=1', logEntries[0]?.n === 1);
        check('mock log preserves background', logEntries[0]?.background === 'auto');
        check('mock log preserves output format', logEntries[0]?.output_format === 'png');
        check(
            'saved image bytes equal fixture bytes',
            !!outputBytes && sha256(outputBytes) === fixtures.baseHash,
            'hash mismatch'
        );
        const servedImage = await fetch(`${baseUrl}${response.json?.images?.[0]?.path}`);
        const servedBytes = Buffer.from(await servedImage.arrayBuffer());
        check('image URL returns the saved original', servedImage.status === 200, `status ${servedImage.status}`);
        check(
            'image URL bytes equal fixture bytes',
            sha256(servedBytes) === fixtures.baseHash,
            'hash mismatch'
        );
        check('metadata json archived', !!metadata, response.text);
        check('metadata schema version is 1', metadata?.schema_version === 1);
        check('metadata local id matches response', metadata?.local_request_id === response.json?.request_id);
        check('metadata upstream id is not local id', metadata?.openai_request_id === 'mock_upstream_abc123');
        check('metadata prompt is exact', metadata?.prompt === promptMarker);
        check('metadata model is exact', metadata?.model === 'gpt-image-2.5-flare');
        check('metadata size is exact', metadata?.size === '1024x1024');
        check('metadata quality is exact', metadata?.quality === 'low');
        check('metadata n is 1', metadata?.n === 1);
        check('metadata background is auto', metadata?.background === 'auto');
        check('metadata output format is png', metadata?.output_format === 'png');
        check('metadata has no reference images', metadata?.reference_image_count === 0);
        check('metadata has no mask', metadata?.has_mask === false);
        check('metadata output filename matches', metadata?.output_filename === response.json?.images?.[0]?.filename);
        check('metadata actual width is 1024', metadata?.actual_width === 1024);
        check('metadata actual height is 1024', metadata?.actual_height === 1024);
        check('metadata size matches request', metadata?.size_matches_request === true);
        check('metadata preserves full usage', metadata?.usage?.output_tokens === response.json?.usage?.output_tokens);
        check('metadata estimated cost is positive', typeof metadata?.estimated_cost_usd === 'number' && metadata.estimated_cost_usd > 0);
        check('metadata cost basis is usage estimate', metadata?.cost_note === 'usage_token_estimate');
        check('metadata marks mock data', metadata?.is_mock === true);
        check('metadata storage mode is fs', metadata?.storage_mode === 'fs');
        check('metadata file count increased by one', (await countMetadata()) === metadataBefore + 1);
        check('output image count increased by one', (await countOutputImages()) === imagesBefore + 1);

        const serverLog = await fs.readFile(mockSession.logPath, 'utf8');
        check('server log does not contain full prompt', !serverLog.includes(promptMarker));
        check('server log does not contain Authorization header', !/authorization\s*:/i.test(serverLog));
        check('server log does not contain bearer token', !/bearer\s+/i.test(serverLog));

        // 2. Transparent PNG: exact bytes, PNG alpha, linkage fields.
        await setScenario({ usage: 'present' });
        await resetMockLog();
        imagesBefore = await countOutputImages();
        response = await postImages(baseUrl, {
            prompt: 'transparent material test',
            size: '1024x1024',
            background: 'transparent',
            format: 'png'
        });
        logEntries = await readMockLog();
        metadata = await readMetadata(response.json);
        outputBytes = await readOutputFile(response.json);
        check('transparent PNG returns 200', response.status === 200, response.text);
        check(
            'transparent request carries background=transparent',
            logEntries[0]?.background === 'transparent',
            JSON.stringify(logEntries[0])
        );
        check(
            'transparent request carries output_format=png',
            logEntries[0]?.output_format === 'png',
            JSON.stringify(logEntries[0])
        );
        check(
            'transparent PNG bytes are unchanged',
            !!outputBytes && sha256(outputBytes) === fixtures.transparentHash,
            'hash mismatch'
        );
        check('transparent PNG has alpha color type', outputBytes?.[25] === 6, `color type ${outputBytes?.[25]}`);
        check('transparent metadata background', metadata?.background === 'transparent');
        check('transparent metadata output format', metadata?.output_format === 'png');
        check('transparent image count increased by one', (await countOutputImages()) === imagesBefore + 1);

        // 3. Native 2048x1152: actual dimensions from bytes and JSON record.
        await setScenario({ usage: 'present', requestId: 'mock_upstream_2k' });
        await resetMockLog();
        response = await postImages(baseUrl, {
            prompt: '2k wide material test',
            size: '2048x1152',
            quality: 'low',
            background: 'opaque',
            format: 'png'
        });
        logEntries = await readMockLog();
        metadata = await readMetadata(response.json);
        outputBytes = await readOutputFile(response.json);
        check('2048x1152 returns 200', response.status === 200, response.text);
        check('2048x1152 response width', response.json?.images?.[0]?.width === 2048, response.text);
        check('2048x1152 response height', response.json?.images?.[0]?.height === 1152, response.text);
        check(
            '2048x1152 bytes equal fixture bytes',
            !!outputBytes && sha256(outputBytes) === fixtures.wide2kHash,
            'hash mismatch'
        );
        check('2048x1152 metadata actual width', metadata?.actual_width === 2048);
        check('2048x1152 metadata actual height', metadata?.actual_height === 1152);
        check('2048x1152 metadata requested width', metadata?.requested_width === 2048);
        check('2048x1152 metadata requested height', metadata?.requested_height === 1152);
        check('2048x1152 metadata size matches request', metadata?.size_matches_request === true);
        check('2048x1152 metadata upstream id', metadata?.openai_request_id === 'mock_upstream_2k');
        check('2048x1152 metadata usage present', !!metadata?.usage);
        check('2048x1152 metadata cost positive', metadata?.estimated_cost_usd > 0);
        check('2048x1152 request logged size', logEntries[0]?.size === '2048x1152');

        // 4. Edit with ordered references and a mask.
        await setScenario({ usage: 'present', requestId: 'mock_upstream_edit' });
        await resetMockLog();
        response = await postImages(baseUrl, {
            mode: 'edit',
            prompt: 'edit with two references and a mask',
            size: '1536x864',
            quality: 'low',
            background: 'auto',
            format: 'png',
            references: [path.join(fixtureDir, 'source-a.png'), path.join(fixtureDir, 'source-b.png')],
            mask: path.join(fixtureDir, 'mask.png')
        });
        logEntries = await readMockLog();
        metadata = await readMetadata(response.json);
        outputBytes = await readOutputFile(response.json);
        check('edit returns 200', response.status === 200, response.text);
        check('edit log operation', logEntries[0]?.operation === 'edit');
        checkEqual('edit reference order', logEntries[0]?.image_filenames, ['source-a.png', 'source-b.png']);
        check('edit log has mask', logEntries[0]?.has_mask === true);
        check('edit log mask filename', logEntries[0]?.mask_filename === 'mask.png');
        check('edit log preserves prompt', logEntries[0]?.prompt === 'edit with two references and a mask');
        check('edit log preserves size', logEntries[0]?.size === '1536x864');
        check('edit metadata reference count', metadata?.reference_image_count === 2);
        checkEqual(
            'edit metadata reference order',
            metadata?.reference_images?.map((item) => item.filename),
            ['source-a.png', 'source-b.png']
        );
        check('edit metadata has mask', metadata?.has_mask === true);
        check('edit metadata mask filename', metadata?.mask_filename === 'mask.png');
        check('edit metadata actual width', metadata?.actual_width === 1536);
        check('edit metadata actual height', metadata?.actual_height === 864);
        check(
            'edit saved bytes equal fixture bytes',
            !!outputBytes && sha256(outputBytes) === fixtures.wideDraftHash,
            'hash mismatch'
        );

        // 5. Validation failures never reach the mock provider.
        await resetMockLog();
        response = await postImages(baseUrl, { prompt: 'n=2 test', n: 2 });
        check('n>1 is rejected', response.status === 400 && response.json?.code === 'N_MUST_BE_ONE', response.text);
        check('n>1 does not call provider', (await readMockLog()).length === 0);

        await resetMockLog();
        response = await postImages(baseUrl, {
            prompt: 'transparent jpeg test',
            background: 'transparent',
            format: 'jpeg'
        });
        check(
            'transparent + jpeg is rejected',
            response.status === 400 && response.json?.code === 'TRANSPARENT_REQUIRES_PNG',
            response.text
        );
        check('transparent + jpeg does not call provider', (await readMockLog()).length === 0);

        await resetMockLog();
        response = await postImages(baseUrl, { prompt: 'bad size test', size: '1000x1000' });
        check('invalid custom size is rejected', response.status === 400 && response.json?.code === 'INVALID_SIZE', response.text);
        check('invalid size does not call provider', (await readMockLog()).length === 0);

        await resetMockLog();
        response = await postImages(baseUrl, { prompt: 'stream test', stream: true });
        check(
            'streaming is rejected',
            response.status === 400 && response.json?.code === 'STREAM_NOT_SUPPORTED',
            response.text
        );
        check('streaming does not call provider', (await readMockLog()).length === 0);

        await resetMockLog();
        response = await postImages(baseUrl, {
            mode: 'edit',
            prompt: 'mask mismatch test',
            size: '1536x864',
            references: [path.join(fixtureDir, 'source-large.png')],
            mask: path.join(fixtureDir, 'mask.png')
        });
        check(
            'mask/source dimension mismatch is rejected',
            response.status === 400 && response.json?.code === 'MASK_SIZE_MISMATCH',
            response.text
        );
        check('mask mismatch does not call provider', (await readMockLog()).length === 0);

        // 6. Missing usage is recorded as unknown, never as zero.
        await setScenario({ usage: 'missing' });
        await resetMockLog();
        response = await postImages(baseUrl, { prompt: 'usage missing test', size: '1024x1024' });
        metadata = await readMetadata(response.json);
        check('missing usage still returns image', response.status === 200, response.text);
        check('missing usage response is null', response.json?.usage === null && response.json?.usage_missing === true, response.text);
        check(
            'missing usage response warns',
            Array.isArray(response.json?.warnings) && response.json.warnings.some((item) => item.includes('usage')),
            JSON.stringify(response.json?.warnings)
        );
        check('missing usage metadata is null', metadata?.usage === null);
        check('missing usage metadata flag', metadata?.usage_missing === true);
        check('missing usage cost is null not zero', metadata?.estimated_cost_usd === null);
        check('missing usage cost note', metadata?.cost_note === 'unknown_missing_usage');

        // 7. Size mismatch preserves the original image and reports it.
        await setScenario({ usage: 'present', fixture: '1024x1024.png' });
        await resetMockLog();
        metadataBefore = await countMetadata();
        response = await postImages(baseUrl, { prompt: 'size mismatch test', size: '2048x1152', background: 'opaque' });
        metadata = await readMetadata(response.json);
        outputBytes = await readOutputFile(response.json);
        check('size mismatch still returns image', response.status === 200, response.text);
        check('size mismatch flag', response.json?.size_mismatch === true, response.text);
        check(
            'size mismatch warning names both sizes',
            response.json?.warnings?.some((item) => item.includes('2048x1152') && item.includes('1024x1024')),
            JSON.stringify(response.json?.warnings)
        );
        check('size mismatch metadata requested size', metadata?.requested_width === 2048 && metadata?.requested_height === 1152);
        check('size mismatch metadata actual size', metadata?.actual_width === 1024 && metadata?.actual_height === 1024);
        check('size mismatch metadata flag', metadata?.size_matches_request === false);
        check(
            'size mismatch preserves original bytes',
            !!outputBytes && sha256(outputBytes) === fixtures.baseHash,
            'hash mismatch'
        );
        check('size mismatch archives metadata', (await countMetadata()) === metadataBefore + 1);

        // 8. Upstream error classification, no retry, no archive.
        const errorCases = [
            ['rate_limit', 429, 'UPSTREAM_RATE_LIMIT'],
            ['unauthorized', 401, 'UPSTREAM_AUTH_ERROR'],
            ['forbidden', 403, 'UPSTREAM_PERMISSION_ERROR'],
            ['timeout', 504, 'UPSTREAM_TIMEOUT'],
            ['server', 502, 'UPSTREAM_SERVER_ERROR']
        ];
        for (const [kind, expectedStatus, expectedCode] of errorCases) {
            await setScenario({ error: kind });
            await resetMockLog();
            const metadataCountBefore = await countMetadata();
            const imageCountBefore = await countOutputImages();
            response = await postImages(baseUrl, { prompt: `error ${kind} test` });
            const message = String(response.json?.error ?? '');
            check(`${kind} maps to status ${expectedStatus}`, response.status === expectedStatus, response.text);
            check(`${kind} maps to code ${expectedCode}`, response.json?.code === expectedCode, response.text);
            check(`${kind} marks billing unknown`, response.json?.billable_unknown === true, response.text);
            check(
                `${kind} does not claim free/unconsumed`,
                !/未消费|免费|free|no charge/i.test(message),
                message
            );
            check(`${kind} calls provider once without retry`, (await readMockLog()).length === 1);
            check(`${kind} writes no metadata`, (await countMetadata()) === metadataCountBefore);
            check(`${kind} writes no image`, (await countOutputImages()) === imageCountBefore);
        }
        await setScenario({ usage: 'present' });

        // 9. Single-request concurrency guard.
        await setScenario({ usage: 'present', delayMs: 800 });
        await resetMockLog();
        metadataBefore = await countMetadata();
        imagesBefore = await countOutputImages();
        const concurrent = await Promise.all([
            postImages(baseUrl, { prompt: 'concurrency test A' }),
            postImages(baseUrl, { prompt: 'concurrency test B' })
        ]);
        const statuses = concurrent.map((item) => item.status).sort((a, b) => a - b);
        const busyResponse = concurrent.find((item) => item.status === 429);
        checkEqual('concurrent statuses are 200 and 429', statuses, [200, 429]);
        check(
            'busy response explains in-flight request',
            busyResponse?.json?.code === 'IMAGE_REQUEST_IN_FLIGHT' &&
                String(busyResponse?.json?.error).includes('已有生成或编辑请求'),
            busyResponse?.text
        );
        check('busy response is not marked billable', busyResponse?.json?.billable_unknown === false);
        check('concurrent requests call provider once', (await readMockLog()).length === 1);
        check('concurrent requests archive one metadata file', (await countMetadata()) === metadataBefore + 1);
        check('concurrent requests save one image', (await countOutputImages()) === imagesBefore + 1);
        await setScenario({ usage: 'present' });

        await stopServer(mockSession);
        mockSession = null;

        // 10. Disabled switch: page works, generate/edit are blocked before the provider.
        const disabledSession = await startServer(disabledConfig);
        try {
            const page = await fetch(`${disabledSession.url}/`);
            const pageHtml = await page.text();
            check('disabled switch page returns 200', page.status === 200);
            check('disabled switch page renders app shell', pageHtml.includes('GPT Image Playground'));

            const authStatus = await (await fetch(`${disabledSession.url}/api/auth-status`)).json();
            check('disabled auth status reports api disabled', authStatus.imageApiEnabled === false);
            check('disabled auth status reports missing key', authStatus.apiKeyConfigured === false);
            check('disabled auth status reports not mock', authStatus.imageApiMock === false);

            const mockLogBeforeDisabled = (await readMockLog()).length;
            response = await postImages(disabledSession.url, { prompt: 'disabled gate test' });
            check('disabled switch blocks generate', response.status === 503 && response.json?.code === 'IMAGE_API_DISABLED', response.text);
            check(
                'disabled switch message is clear',
                String(response.json?.error).includes('生成服务未启用'),
                response.text
            );
            check('disabled switch does not reach provider', (await readMockLog()).length === mockLogBeforeDisabled);

            response = await postImages(disabledSession.url, {
                mode: 'edit',
                prompt: 'disabled edit gate test',
                references: [path.join(fixtureDir, 'source-a.png')]
            });
            check('disabled switch blocks edit', response.status === 503 && response.json?.code === 'IMAGE_API_DISABLED', response.text);
        } finally {
            await stopServer(disabledSession);
        }

        // 11. Enabled but no key: page works, request blocked before SDK/network.
        const keyMissingSession = await startServer(keyMissingConfig);
        try {
            const page = await fetch(`${keyMissingSession.url}/`);
            check('missing key page returns 200', page.status === 200);
            const authStatus = await (await fetch(`${keyMissingSession.url}/api/auth-status`)).json();
            check('missing key auth status reports enabled', authStatus.imageApiEnabled === true);
            check('missing key auth status reports no key', authStatus.apiKeyConfigured === false);
            response = await postImages(keyMissingSession.url, { prompt: 'missing key test' });
            check(
                'missing key is blocked with config error',
                response.status === 503 && response.json?.code === 'OPENAI_API_KEY_MISSING',
                response.text
            );
            check(
                'missing key message is clear',
                String(response.json?.error).includes('OPENAI_API_KEY'),
                response.text
            );
        } finally {
            await stopServer(keyMissingSession);
        }

        // 12. Client bundle and local config secret checks.
        const secretScan = await scanClientBundleForSecrets();
        check('client bundle scanned', secretScan.scannedFiles > 0, `scanned ${secretScan.scannedFiles}`);
        checkEqual('client bundle has no key names/tokens', secretScan.hits, []);

        const envLocal = await fs.readFile(path.join(repoRoot, '.env.local'), 'utf8');
        const keyLine = envLocal.split(/\r?\n/).find((line) => line.trim().startsWith('OPENAI_API_KEY='));
        check('local env has no real key configured', !!keyLine && keyLine.split('=').slice(1).join('=').trim() === '');
    } finally {
        if (mockSession) await stopServer(mockSession);
    }

    console.log('\n================ ACCEPTANCE SUMMARY ================');
    console.log(`PASS: ${passed.length}`);
    console.log(`FAIL: ${failed.length}`);
    if (failed.length > 0) {
        for (const item of failed) {
            console.log(`- ${item.name}${item.detail ? `: ${item.detail}` : ''}`);
        }
        console.log('Artifacts kept at: test-artifacts/');
        process.exit(1);
    }
    console.log('All no-real-API acceptance checks passed.');
    console.log('Artifacts kept at: test-artifacts/ (ignored by git).');
}

await main();
