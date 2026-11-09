import fs from 'node:fs';
import fsSync from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createFixturePng, sha256 } from './lib/png-fixture.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const artifactsDir = path.join(repoRoot, 'test-artifacts', 'workbench-acceptance');
const fixtureDir = path.join(artifactsDir, 'fixtures');
const dataDir = path.join(artifactsDir, 'data');
const outputDir = path.join(artifactsDir, 'images');
const scenarioFile = path.join(artifactsDir, 'scenario.json');
const mockLog = path.join(artifactsDir, 'mock-calls.jsonl');
const serverLogPath = path.join(artifactsDir, 'server.log');
const workerLogPath = path.join(artifactsDir, 'worker.log');
const screenshotDir = path.join(artifactsDir, 'screenshots');
const dbPath = path.join(dataDir, 'workbench.sqlite');
const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const token = 'acceptance-worker-token-0123456789';

const CASE_A =
    '以我选定官图里的阿米娅为主角，侧背面自然行走。场景是一片舞台街景布景，左侧能看见完成的建筑正面，右侧能看见布景背面的木支架，两者属于同一个可信空间。人物在中景清楚可辨，耳朵和鞋子完整入画，安静、克制，16:9。服装结构参考选定官图，动作不照抄立绘。先设计并补充需要的参考图，等我确认后再生成。';
const CASE_B =
    '只参考这张图的色彩、光线、边缘处理、线条和细节取舍，不保留原图人物与场景；为阿米娅设计一个新的安静日常画面，先给我方案。';

const passed = [];
const failed = [];

function check(name, condition, detail) {
    if (condition) {
        passed.push(name);
        console.log(`PASS  ${name}`);
    } else {
        failed.push({ name, detail });
        console.error(`FAIL  ${name}${detail ? `\n      ${String(detail).slice(0, 500)}` : ''}`);
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

function ensureArtifacts() {
    fs.rmSync(artifactsDir, { recursive: true, force: true });
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(screenshotDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'worker-token'), `${token}\n`);

    const base = createFixturePng(2048, 1152);
    const sourceA = createFixturePng(1024, 1024, {
        pixel: (x, y) => [Math.floor((255 * x) / 1024), 80, 80, 255]
    });
    const sourceB = createFixturePng(1024, 1024, {
        pixel: (x, y) => [80, Math.floor((255 * y) / 1024), 190, 255]
    });
    const style = createFixturePng(960, 540, {
        pixel: (x, y) => [80, 100, Math.floor((255 * (x + y)) / 1500), 255]
    });
    fs.writeFileSync(path.join(fixtureDir, '2048x1152.png'), base);
    fs.writeFileSync(path.join(fixtureDir, 'default.png'), base);
    fs.writeFileSync(path.join(fixtureDir, 'source-a.png'), sourceA);
    fs.writeFileSync(path.join(fixtureDir, 'source-b.png'), sourceB);
    fs.writeFileSync(path.join(fixtureDir, 'style-ref.png'), style);
    fs.writeFileSync(scenarioFile, JSON.stringify({ usage: 'present' }, null, 2));
    fs.writeFileSync(mockLog, '');

    return {
        baseHash: sha256(base),
        sourceAHash: sha256(sourceA),
        styleHash: sha256(style),
        stylePng: style
    };
}

async function isPortFree(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => server.close(() => resolve(true)));
        server.listen(port, '127.0.0.1');
    });
}

async function findFreePort(start) {
    for (let port = start; port < start + 200; port++) {
        if (await isPortFree(port)) return port;
    }
    throw new Error(`No free port starting at ${start}`);
}

function serverEnv(port) {
    return {
        NODE_ENV: 'development',
        WORKBENCH_MOCK: '',
        IMAGE_API_MOCK_FIXTURE_DIR: '',
        OPENAI_API_KEY: '',
        ENABLE_IMAGE_API: 'true',
        NEXT_PUBLIC_IMAGE_STORAGE_MODE: 'fs',
        NEXT_TELEMETRY_DISABLED: '1',
        IMAGE_API_TEST_FIXTURE_DIR: fixtureDir,
        IMAGE_API_TEST_SCENARIO_FILE: scenarioFile,
        IMAGE_API_TEST_LOG: mockLog,
        IMAGE_API_TEST_UNIQUE: '1',
        IMAGE_OUTPUT_DIR: outputDir,
        WORKBENCH_TEST_FIXTURES: '1',
        WORKBENCH_DATA_DIR: dataDir,
        WORKBENCH_TEST_SCENARIO_FILE: scenarioFile,
        WORKBENCH_WORKER_TOKEN: token,
        WORKBENCH_WORKER_URL: `http://127.0.0.1:${port}`,
        WORKBENCH_TEST_STRICT_AUTHORIZATION: '1',
        WORKBENCH_TEST_ALLOW_LOOPBACK: '1'
    };
}

async function waitForServer(url, timeoutMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const response = await fetch(`${url}/api/workbench/status`, { signal: AbortSignal.timeout(3000) });
            if (response.ok) return;
        } catch {
            // still starting
        }
        await sleep(500);
    }
    throw new Error(`Server did not become ready at ${url}`);
}

async function startServer(port, overrides = {}) {
    const logFd = fsSync.openSync(serverLogPath, 'a');
    const child = spawn(
        process.execPath,
        [nextBin, 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', String(port)],
        { cwd: repoRoot, env: { ...process.env, ...serverEnv(port), ...overrides }, stdio: ['ignore', logFd, logFd] }
    );
    const url = `http://127.0.0.1:${port}`;
    try {
        await waitForServer(url);
    } catch (error) {
        await stopProcess(child);
        throw error;
    }
    return { child, url, logFd };
}

async function stopProcess(child) {
    if (!child || child.exitCode !== null) return;
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
        child.kill('SIGTERM');
    }
    await sleep(500);
}

async function api(baseUrl, pathname, options = {}) {
    const headers = { origin: baseUrl, ...(options.headers || {}) };
    const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers, signal: AbortSignal.timeout(180000) });
    const text = await response.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }
    return { status: response.status, json, text, headers: response.headers };
}

async function postJson(baseUrl, pathname, body) {
    return api(baseUrl, pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
}

async function action(baseUrl, projectId, actionName, payload = {}) {
    return postJson(baseUrl, `/api/workbench/projects/${projectId}/actions`, { action: actionName, ...payload });
}

async function detail(baseUrl, projectId) {
    const response = await api(baseUrl, `/api/workbench/projects/${projectId}`);
    if (response.status !== 200) throw new Error(`detail failed ${response.status}: ${response.text}`);
    return response.json.project;
}

async function createProject(baseUrl, text, entry = 'keyword', extra = {}) {
    const response = await postJson(baseUrl, '/api/workbench/projects', {
        text,
        entry,
        confirmPlanner: true,
        ...extra
    });
    if (response.status !== 200) throw new Error(`create project failed ${response.status}: ${response.text}`);
    return response.json.project;
}

async function upload(baseUrl, projectId, bytes, filename, mime = 'image/png') {
    const form = new FormData();
    form.append('file', new File([bytes], filename, { type: mime }));
    const response = await fetch(`${baseUrl}/api/workbench/projects/${projectId}/upload`, {
        method: 'POST',
        headers: { origin: baseUrl },
        body: form
    });
    const json = await response.json();
    if (!response.ok) throw new Error(`upload failed ${response.status}: ${JSON.stringify(json)}`);
    return json;
}

async function workerPost(baseUrl, pathname) {
    return api(baseUrl, pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-worker-token': token },
        body: '{}'
    });
}

async function tick(baseUrl) {
    const response = await workerPost(baseUrl, '/api/workbench/internal/tick');
    const json = response.json;
    if (response.status !== 200) throw new Error(`tick failed ${response.status}: ${response.text}`);
    return json;
}

async function drain(baseUrl, max = 20) {
    const results = [];
    for (let index = 0; index < max; index++) {
        const result = await tick(baseUrl);
        results.push(result);
        if (!result.didWork) break;
    }
    return results;
}

function setScenario(scenario) {
    fs.writeFileSync(scenarioFile, `${JSON.stringify(scenario, null, 2)}\n`);
}

function readMockLog() {
    try {
        return fs
            .readFileSync(mockLog, 'utf8')
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    } catch {
        return [];
    }
}

function openDb() {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 5000;');
    return db;
}

function insertCandidate(db, projectId, imageUrl, pageUrl, title) {
    const id = `candidate-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    db.prepare(
        `INSERT INTO search_candidates (id, project_id, query, query_kind, title, image_url, thumbnail_url, page_url,
            domain, trust_note, license_note, suggested_purpose, width, height, status, asset_id, error, mock, created_at)
         VALUES (?, ?, 'acceptance', 'space', ?, ?, ?, ?, '127.0.0.1', '未核验来源', '授权状态未知', 'space', NULL, NULL,
            'candidate', NULL, NULL, 0, ?)`
    ).run(id, projectId, title, imageUrl, imageUrl, pageUrl, new Date().toISOString());
    return id;
}

async function findRun(projectId, runId, baseUrl) {
    const project = await detail(baseUrl, projectId);
    return project.runs.find((run) => run.id === runId) ?? null;
}

async function waitForRunStatus(baseUrl, projectId, runId, statuses, timeoutMs = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const run = await findRun(projectId, runId, baseUrl);
        if (run && statuses.includes(run.status)) return run;
        await sleep(400);
    }
    return findRun(projectId, runId, baseUrl);
}

function chromePath() {
    const candidates = [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function screenshot(url, filename) {
    const chrome = chromePath();
    if (!chrome) return false;
    const output = path.join(screenshotDir, filename);
    const result = spawnSync(
        chrome,
        [
            '--headless=new',
            '--disable-gpu',
            '--hide-scrollbars',
            '--window-size=1680,1600',
            '--virtual-time-budget=12000',
            `--screenshot=${output}`,
            url
        ],
        { stdio: 'ignore', timeout: 60000 }
    );
    return result.status === 0 && fs.existsSync(output);
}

async function main() {
    const fixtures = ensureArtifacts();
    const port = await findFreePort(3300);
    const baseUrl = `http://127.0.0.1:${port}`;
    let server = null;
    let localHttp = null;
    let worker = null;

    try {
        server = await startServer(port);
        const initialMockCalls = readMockLog().length;
        check('initial mock call log is empty', initialMockCalls === 0, `got ${initialMockCalls}`);

        // ---------- Page loads without paid calls ----------
        const page = await api(baseUrl, '/workbench');
        check('workbench page returns 200', page.status === 200, page.text.slice(0, 200));
        check('workbench page renders app title', page.text.includes('创作工作台'));
        const home = await api(baseUrl, '/');
        check('legacy home page still returns 200', home.status === 200);
        const status = await api(baseUrl, '/api/workbench/status');
        check('status has no retired mode flags', status.json?.status && !('mock' in status.json.status) && !('mode' in status.json.status) && !('autoRestartAvailable' in status.json.status), status.text);
        check('default planner model is gpt-6.1-sol', status.json?.status?.plannerModel === 'gpt-6.1-sol', status.text);
        check(
            'planner model list is switchable',
            Array.isArray(status.json?.status?.plannerModels) &&
                status.json.status.plannerModels.includes('gpt-6.1-sol') &&
                status.json.status.plannerModels.includes('gpt-6-astra')
        );
        check('default planner reasoning effort is medium', status.json?.status?.plannerReasoningEffort === 'medium');
        checkEqual(
            'planner reasoning effort options',
            status.json?.status?.plannerReasoningEfforts,
            ['low', 'medium', 'high', 'xhigh', 'max']
        );
        check('search model default is gpt-6.1-sol', status.json?.status?.searchModel === 'gpt-6.1-sol');
        check('review model default is gpt-6.1-sol', status.json?.status?.reviewModel === 'gpt-6.1-sol');
        check('analysis model default is gpt-6.1-sol', status.json?.status?.analysisModel === 'gpt-6.1-sol');
        const removedModeGet = await api(baseUrl, '/api/workbench/mode');
        const removedModePost = await postJson(baseUrl, '/api/workbench/mode', { mode: 'mock', confirm: true });
        check('retired mode GET endpoint is unavailable', removedModeGet.status === 404);
        check('retired mode POST endpoint is unavailable', removedModePost.status === 404);
        const projectsEmpty = await api(baseUrl, '/api/workbench/projects');
        checkEqual('no projects yet', projectsEmpty.json?.projects?.length, 0);
        check('page load and history reads do not call image API', readMockLog().length === initialMockCalls, `got ${readMockLog().length}`);
        const warmRecover = await workerPost(baseUrl, '/api/workbench/internal/recover');
        check('worker recovery endpoint requires token and is warm', warmRecover.status === 200 && warmRecover.json?.recovered === 0, warmRecover.text);

        // ---------- Project A + design card + locks + manual prompt ----------
        const projectA = await createProject(baseUrl, CASE_A, 'keyword');
        const projectAId = projectA.project.id;
        check('case A project created', !!projectAId);
        check('case A design has subject', projectA.design.subject.includes('阿米娅'), projectA.design.subject);
        check('case A missing references are explicit', projectA.design.missingReferences.length >= 3, JSON.stringify(projectA.design.missingReferences));
        check('creating design does not generate images', projectA.versions.length === 0 && projectA.runs.length === 0);
        check('creating design does not call image API', readMockLog().length === initialMockCalls);

        const marker = 'LOCKED_COMPOSITION_MARKER';
        let save = await action(baseUrl, projectAId, 'design.save', {
            card: { ...projectA.design, composition: marker },
            lockedFields: ['composition']
        });
        check('design save returns 200', save.status === 200, save.text);
        check('locked field stored', save.json?.project?.lockedFields?.includes('composition'));

        const update = await action(baseUrl, projectAId, 'design.update', {
            instruction: '人物稍微大一点，服装和场景核心关系保持',
            confirmPlanner: true
        });
        check('locked change is reported as conflict', update.status === 200 && update.json?.result?.conflicts?.some((item) => item.field === 'composition'), update.text);
        check(
            'locked field is not overwritten',
            update.json?.project?.design?.composition === marker,
            update.json?.project?.design?.composition
        );
        const proposedComposition = update.json?.result?.conflicts?.find((item) => item.field === 'composition')?.proposed;
        await action(baseUrl, projectAId, 'design.unlock', { fields: ['composition'] });
        await action(baseUrl, projectAId, 'design.save', {
            card: { ...update.json.project.design, composition: proposedComposition },
            lockedFields: []
        });

        const manualMarker = `MANUAL_PROMPT_MARKER_${Date.now()}`;
        const manual = await action(baseUrl, projectAId, 'prompt.saveManual', {
            text: `${manualMarker}\n【主体】按手动修订`,
            avoid: '避免改变人物服装结构',
            acceptance: '人工验收：服装与空间关系'
        });
        check('manual prompt saved', manual.status === 200 && manual.json?.project?.prompt?.source === 'manual', manual.text);
        const mutate = await action(baseUrl, projectAId, 'design.save', {
            card: { ...manual.json.project.design, sceneIntent: `${manual.json.project.design.sceneIntent}（补充：更安静）` },
            lockedFields: []
        });
        check('design change marks prompt stale', mutate.json?.project?.prompt?.stale === true);
        check('manual prompt text is preserved while stale', mutate.json?.project?.prompt?.text?.includes(manualMarker));
        const keep = await action(baseUrl, projectAId, 'prompt.keepManual');
        check('keep manual prompt clears stale', keep.json?.project?.prompt?.stale === false && keep.json?.project?.prompt?.source === 'manual');
        await action(baseUrl, projectAId, 'prompt.compile');
        const compiled = await detail(baseUrl, projectAId);
        check('compile replaces manual with compiled prompt', compiled.prompt.text.includes('【主体】') && !compiled.prompt.text.includes(manualMarker));
        check('compile clears stale', compiled.prompt.stale === false);

        // ---------- Assets, analysis cache, search, bindings ----------
        const uploadedA = await upload(baseUrl, projectAId, fs.readFileSync(path.join(fixtureDir, 'source-a.png')), 'amiya-official.png');
        const duplicate = await upload(baseUrl, projectAId, fs.readFileSync(path.join(fixtureDir, 'source-a.png')), 'amiya-copy.png');
        check('upload returns actual dimensions', uploadedA.asset.width === 1024 && uploadedA.asset.height === 1024);
        check('same content hash dedupes across uploads', duplicate.asset.id === uploadedA.asset.id, `${duplicate.asset.id} vs ${uploadedA.asset.id}`);

        const analyzed = await action(baseUrl, projectAId, 'assets.analyze', {
            assetId: uploadedA.asset.id,
            confirmAnalysis: true
        });
        check('analysis suggests character purpose', analyzed.json?.analysis?.suggestedPurpose === 'character', analyzed.text);
        check('analysis separates observable/inference/uncertainty',
            analyzed.json?.analysis?.observable?.length > 0 &&
            analyzed.json?.analysis?.inferences?.length > 0 &&
            analyzed.json?.analysis?.uncertainties?.length > 0);
        const analyzedAgain = await action(baseUrl, projectAId, 'assets.analyze', {
            assetId: uploadedA.asset.id,
            confirmAnalysis: true
        });
        check('analysis is cached by hash + config', analyzedAgain.json?.analysis?.analyzedAt === analyzed.json?.analysis?.analyzedAt);
        const manualAnalysis = await action(baseUrl, projectAId, 'assets.updateAnalysis', {
            assetId: uploadedA.asset.id,
            analysis: {
                observable: ['MANUAL_OBSERVATION_MARKER'],
                inferences: ['人工修正的推测'],
                uncertainties: ['人工修正的不确定项'],
                styleLanguage: '人工修正的绘画语言',
                suggestedPurpose: 'character'
            }
        });
        check('analysis result can be edited by the user', manualAnalysis.status === 200 && manualAnalysis.json?.analysis?.observable?.includes('MANUAL_OBSERVATION_MARKER'), manualAnalysis.text);
        check('manual analysis is marked as manual edit', manualAnalysis.json?.analysis?.model === 'manual-edit');

        setScenario({ searchEmpty: true });
        const emptySearch = await action(baseUrl, projectAId, 'search.run', {
            confirmSearch: true,
            queries: [{ kind: 'space', query: 'empty search query' }]
        });
        check('empty search reports real failure', emptySearch.status === 422 && emptySearch.json?.code === 'NO_IMAGE_RESULTS', emptySearch.text);
        setScenario({ usage: 'present' });
        const search = await action(baseUrl, projectAId, 'search.run', {
            confirmSearch: true,
            queries: [
                { kind: 'space', query: 'theatre stage backdrop wooden support' },
                { kind: 'pose', query: 'anime character walking away side view' }
            ]
        });
        check('search returns actual candidates', search.status === 200 && search.json?.candidates?.length === 8, search.text);
        check('search reports call count', search.json?.calls === 2);
        check('search candidates include source and unverified notes',
            search.json.candidates.every((item) => item.pageUrl.startsWith('http') && item.trustNote.includes('未核验') && item.licenseNote.includes('授权状态未知')));
        const candidate = search.json.candidates[0];
        const imported = await action(baseUrl, projectAId, 'candidate.import', { candidateId: candidate.id });
        check('candidate import succeeds', imported.status === 200 && !!imported.json?.asset?.id, imported.text);
        check('candidate import keeps source page', imported.json?.asset?.sourcePage === candidate.pageUrl);
        check('candidate marked imported', imported.json?.project?.candidates?.find((item) => item.id === candidate.id)?.status === 'imported');

        const bindingBase = [
            {
                assetId: uploadedA.asset.id,
                purpose: 'character',
                borrow: '角色轮廓、服装分区、耳朵',
                exclude: '不要照抄站姿',
                position: 0
            },
            {
                assetId: imported.json.asset.id,
                purpose: 'space',
                borrow: '建筑正面与木支架结构',
                exclude: '不要借用其人物',
                position: 1
            }
        ];
        let bindings = await action(baseUrl, projectAId, 'references.save', { bindings: bindingBase });
        check('bindings saved', bindings.status === 200 && bindings.json?.references?.length === 2, bindings.text);
        const reordered = [
            { ...bindingBase[1], position: 0 },
            { ...bindingBase[0], position: 1 }
        ];
        bindings = await action(baseUrl, projectAId, 'references.save', { bindings: reordered });
        check(
            'reorder keeps purpose attached to asset id',
            bindings.json?.references?.[0]?.assetId === imported.json.asset.id &&
                bindings.json?.references?.[0]?.purpose === 'space' &&
                bindings.json?.references?.[1]?.assetId === uploadedA.asset.id &&
                bindings.json?.references?.[1]?.purpose === 'character'
        );
        await action(baseUrl, projectAId, 'references.save', { bindings: bindingBase });
        await action(baseUrl, projectAId, 'prompt.compile');
        const promptSnapshot = await detail(baseUrl, projectAId);
        check('prompt lists reference order', promptSnapshot.prompt.text.includes('1. 参考图 1') && promptSnapshot.prompt.text.includes('2. 参考图 2'));

        // ---------- Case B: style image analyzed separately, cross-project reuse ----------
        const switchedProject = await createProject(baseUrl, '测试规划模型与思考强度切换', 'keyword', {
            plannerModel: 'gpt-6-astra',
            reasoningEffort: 'high'
        });
        const dbPlanner = openDb();
        const switchedRevision = dbPlanner
            .prepare('SELECT planner_model, reasoning_effort FROM design_revisions WHERE project_id = ? ORDER BY version DESC LIMIT 1')
            .get(switchedProject.project.id);
        dbPlanner.close();
        check(
            'planner model and effort are recorded per revision',
            switchedRevision?.planner_model === 'gpt-6-astra' && switchedRevision?.reasoning_effort === 'high',
            JSON.stringify(switchedRevision)
        );
        const badPlannerModel = await postJson(baseUrl, '/api/workbench/projects', {
            text: '非法规划模型测试',
            confirmPlanner: true,
            plannerModel: 'not-allowed-model'
        });
        check(
            'planner model outside allow-list is rejected',
            badPlannerModel.status === 400 && badPlannerModel.json?.code === 'INVALID_PLANNER_MODEL',
            badPlannerModel.text
        );
        const badPlannerEffort = await action(baseUrl, switchedProject.project.id, 'design.update', {
            instruction: '保持现有设计',
            confirmPlanner: true,
            reasoningEffort: 'none'
        });
        check(
            'unsupported reasoning effort is rejected',
            badPlannerEffort.status === 400 && badPlannerEffort.json?.code === 'INVALID_REASONING_EFFORT',
            badPlannerEffort.text
        );

        const projectB = await createProject(baseUrl, CASE_B, 'upload');
        const projectBId = projectB.project.id;
        const styleUpload = await upload(
            baseUrl,
            projectBId,
            fs.readFileSync(path.join(fixtureDir, 'style-ref.png')),
            'style-reference.png'
        );
        const styleAnalysis = await action(baseUrl, projectBId, 'assets.analyze', {
            assetId: styleUpload.asset.id,
            confirmAnalysis: true
        });
        check('style image is actually analyzed', styleAnalysis.json?.analysis?.suggestedPurpose === 'style' && styleAnalysis.json?.analysis?.styleLanguage?.length > 0);
        const styleBindings = await action(baseUrl, projectBId, 'references.save', {
            bindings: [
                { assetId: uploadedA.asset.id, purpose: 'character', borrow: '角色外观与服装以官图为准', exclude: '不要借用风格图人物', position: 0 },
                { assetId: styleUpload.asset.id, purpose: 'style', borrow: '色彩、光线、边缘、线条与细节取舍', exclude: '不保留原图人物与场景', position: 1 }
            ]
        });
        check('case B binds character and style separately', styleBindings.json?.references?.length === 2);
        check(
            'case B reuses asset from another project without re-upload',
            styleBindings.json?.references?.some((item) => item.assetId === uploadedA.asset.id)
        );
        const duplicateInB = await upload(
            baseUrl,
            projectBId,
            fs.readFileSync(path.join(fixtureDir, 'source-a.png')),
            'amiya-copy-project-b.png'
        );
        const detailB = await detail(baseUrl, projectBId);
        check(
            're-uploading the same bytes in another project reuses the asset and links it',
            duplicateInB.asset.id === uploadedA.asset.id &&
                detailB.assets.some((asset) => asset.id === uploadedA.asset.id)
        );
        const styleDesign = await action(baseUrl, projectBId, 'design.update', {
            instruction: '只借鉴这张风格图的色彩、光线、边缘和细节取舍，不复述原图人物与场景，重新整理设计方案',
            confirmPlanner: true
        });
        check('case B design update applies style-only change', styleDesign.status === 200 && styleDesign.json?.result?.changeSummary?.length > 0, styleDesign.text);
        check('case B keeps Amiya subject', styleDesign.json?.project?.design?.subject?.includes('阿米娅'));

        // ---------- Generation: snapshot immutability, dedupe, references ----------
        setScenario({ usage: 'present' });
        const genActionId = `acceptance-gen-${Date.now()}`;
        const genPayload = {
            actionId: genActionId,
            run: {
                action: 'generate',
                imageCount: 2,
                model: 'gpt-image-2.6-sunburst',
                size: '2048x1152',
                quality: 'high',
                background: 'auto',
                outputFormat: 'png',
                moderation: 'auto',
                budgetUsd: 1,
                riskAcknowledged: true
            }
        };
        const runResponse = await action(baseUrl, projectAId, 'run.create', genPayload);
        check('generation run created', runResponse.status === 200 && !!runResponse.json?.run?.id, runResponse.text);
        const genRunId = runResponse.json.run.id;
        check('generation queued with two image items', runResponse.json.run.status === 'queued' && runResponse.json.run.items.length === 2);
        check('snapshot stores two references', runResponse.json.run.snapshot.references.length === 2);
        const callsBeforeRefresh = readMockLog().length;
        await api(baseUrl, '/workbench');
        check('refreshing page while queued does not call image API', readMockLog().length === callsBeforeRefresh);

        await action(baseUrl, projectAId, 'design.save', {
            card: { ...(await detail(baseUrl, projectAId)).design, sceneIntent: 'SNAPSHOT_MUTATION_AFTER_CONFIRM' },
            lockedFields: []
        });
        await action(baseUrl, projectAId, 'references.save', {
            bindings: [
                { assetId: uploadedA.asset.id, purpose: 'composition', borrow: 'mutation', exclude: '', position: 0 }
            ]
        });

        const genTicks = await drain(baseUrl);
        check('generation took four steps', genTicks.filter((item) => item.didWork).length === 4, JSON.stringify(genTicks.map((item) => item.kind)));
        let detailA = await detail(baseUrl, projectAId);
        const genRun = detailA.runs.find((run) => run.id === genRunId);
        check('generation completed', genRun?.status === 'completed', genRun?.status);
        check('two independent versions saved', detailA.versions.length === 2);
        check(
            'two-image batch produces distinct files, not copies',
            detailA.versions[0].assetId !== detailA.versions[1].assetId &&
                detailA.versions[0].asset.sha256 !== detailA.versions[1].asset.sha256
        );
        check('both reviews available', detailA.versions.every((version) => version.reviewStatus === 'available'));
        check('two-image review includes comparison', detailA.versions.some((version) => version.review?.comparison));
        const genLogs = readMockLog().slice(-2);
        check('generation made two image calls', genLogs.length === 2 && genLogs.every((item) => item.operation === 'edit'));
        check(
            'image call uses snapshot reference order',
            genLogs.every((item) => item.image_filenames.length === 2 &&
                item.image_filenames[0].startsWith('01-character-') &&
                item.image_filenames[1].startsWith('02-space-')),
            JSON.stringify(genLogs.map((item) => item.image_filenames))
        );
        check(
            'image call uses snapshot prompt, not mutated draft',
            genLogs.every((item) => item.prompt.includes('【主体】') && !item.prompt.includes('SNAPSHOT_MUTATION_AFTER_CONFIRM'))
        );

        const dedupe = await action(baseUrl, projectAId, 'run.create', genPayload);
        check('double submit returns same run', dedupe.json?.run?.id === genRunId && dedupe.json?.reused === true, dedupe.text);
        check('double submit creates no new calls', readMockLog().length === callsBeforeRefresh + 2);

        // restore prompt and references for the next actions
        await action(baseUrl, projectAId, 'references.save', { bindings: bindingBase });
        await action(baseUrl, projectAId, 'prompt.compile');

        const concurrentActionId = `acceptance-concurrent-${Date.now()}`;
        const concurrentPayload = {
            actionId: concurrentActionId,
            run: { ...genPayload.run, imageCount: 1 }
        };
        const [concurrentA, concurrentB] = await Promise.all([
            action(baseUrl, projectAId, 'run.create', concurrentPayload),
            action(baseUrl, projectAId, 'run.create', concurrentPayload)
        ]);
        check(
            'concurrent identical actions create one run',
            concurrentA.json?.run?.id === concurrentB.json?.run?.id && !!concurrentA.json?.run?.id,
            concurrentA.text
        );
        if (concurrentA.json?.run?.id) {
            await action(baseUrl, projectAId, 'run.stop', { runId: concurrentA.json.run.id });
        }
        const roleRun = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-gen-same-prompt-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 1 }
        });
        check('same prompt can be legally re-rolled with a new action key', roleRun.json?.run?.id !== genRunId, roleRun.text);
        if (roleRun.json?.run?.id) {
            await action(baseUrl, projectAId, 'run.stop', { runId: roleRun.json.run.id });
        }
        check('stop before start skips without calling', readMockLog().length === callsBeforeRefresh + 2);

        // ---------- Downloads ----------
        const versionA = detailA.versions[0];
        const download = await fetch(`${baseUrl}/api/workbench/versions/${versionA.id}/download`, {
            headers: { origin: baseUrl }
        });
        const downloadBytes = Buffer.from(await download.arrayBuffer());
        check('original download success', download.status === 200);
        check('original download bytes match stored hash', sha256(downloadBytes) === versionA.asset.sha256);
        check('download reports actual dimensions', download.headers.get('x-image-width') === '2048' && download.headers.get('x-image-height') === '1152');
        const infoResponse = await fetch(`${baseUrl}/api/workbench/versions/${versionA.id}/download?format=info`, {
            headers: { origin: baseUrl }
        });
        const infoText = await infoResponse.text();
        const info = JSON.parse(infoText);
        check('info record contains prompt and references', info.prompt?.text?.includes('【主体】') && info.references?.length === 2);
        check('info record contains usage/cost note', info.run?.estimatedCostUsd !== undefined && info.note?.includes('不是账单'));
        check('info record contains no key material', !/sk-|OPENAI_API_KEY|Bearer\s/i.test(infoText));

        // ---------- Revision ----------
        const reviseResponse = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-revise-${Date.now()}`,
            run: {
                action: 'revise',
                baseVersionId: versionA.id,
                changePoints: ['把背景木支架的细节对比降低'],
                keepPoints: ['人物尺度与左右空间关系', '服装结构'],
                imageCount: 1,
                model: 'gpt-image-2.6-sunburst',
                size: '2048x1152',
                quality: 'high',
                background: 'auto',
                outputFormat: 'png',
                moderation: 'auto',
                budgetUsd: 1,
                riskAcknowledged: true
            }
        });
        check('revision run created', reviseResponse.status === 200 && reviseResponse.json?.run?.snapshot?.operation?.action === 'revise', reviseResponse.text);
        const revisionTicks = await drain(baseUrl);
        check('revision executes one edit and one review', revisionTicks.filter((item) => item.didWork).length === 2, JSON.stringify(revisionTicks));
        detailA = await detail(baseUrl, projectAId);
        const revised = detailA.versions.find((version) => version.parentVersionId === versionA.id);
        check('revision creates child version', !!revised && revised.label === `${versionA.label}1`, revised?.label);
        check('original versions remain', detailA.versions.some((version) => version.id === versionA.id) && detailA.versions.length === 3);
        const revisionLog = readMockLog().at(-1);
        check('revision uses selected version as edit base', revisionLog?.image_filenames?.[0]?.startsWith(`00-base-${versionA.label}-`), JSON.stringify(revisionLog?.image_filenames));
        check('revision prompt contains change point', revisionLog?.prompt?.includes('本次定向修订') && revisionLog?.prompt?.includes('把背景木支架的细节对比降低'));
        const baselineSwitch = await action(baseUrl, projectAId, 'version.baseline', { versionId: revised.id });
        check('baseline can move to revision', baselineSwitch.json?.project?.project?.baselineVersionId === revised.id);
        await action(baseUrl, projectAId, 'version.baseline', { versionId: versionA.id });
        const revInfo = JSON.parse(
            await (
                await fetch(`${baseUrl}/api/workbench/versions/${revised.id}/download?format=info`, { headers: { origin: baseUrl } })
            ).text()
        );
        check('revision info records parent', revInfo.version?.parentVersionId === versionA.id);

        // ---------- Reroll ----------
        const sourceRun = detailA.runs.find((run) => run.id === genRunId);
        const rerollResponse = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-reroll-${Date.now()}`,
            run: {
                action: 'reroll',
                sourceRunId: genRunId,
                budgetUsd: 1,
                riskAcknowledged: true
            }
        });
        check('reroll run created', rerollResponse.status === 200 && rerollResponse.json?.run?.snapshot?.operation?.action === 'reroll', rerollResponse.text);
        checkEqual(
            'reroll reuses prompt and references',
            {
                prompt: rerollResponse.json.run.snapshot.prompt,
                refs: rerollResponse.json.run.snapshot.references.map((item) => [item.assetId, item.purpose, item.position])
            },
            {
                prompt: sourceRun.snapshot.prompt,
                refs: sourceRun.snapshot.references.map((item) => [item.assetId, item.purpose, item.position])
            }
        );
        const rerollTicks = await drain(baseUrl);
        check('reroll executes two images and two reviews', rerollTicks.filter((item) => item.didWork).length === 4, JSON.stringify(rerollTicks));
        detailA = await detail(baseUrl, projectAId);
        check('reroll adds root versions without touching design', detailA.versions.filter((version) => !version.parentVersionId).length === 4);

        // ---------- Authorization gates ----------
        const noRisk = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-no-risk-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 1, riskAcknowledged: false }
        });
        check('missing risk acknowledgement is blocked', noRisk.status === 402 && noRisk.json?.code === 'RISK_NOT_ACKNOWLEDGED', noRisk.text);
        const zeroBudget = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-zero-budget-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 1, budgetUsd: 0 }
        });
        check('zero budget is blocked', zeroBudget.status === 400 && zeroBudget.json?.code === 'INVALID_BUDGET', zeroBudget.text);
        check('blocked authorizations never call image API', readMockLog().length === callsBeforeRefresh + 2 + 1 + 2);

        // ---------- Partial failure ----------
        setScenario({ usage: 'present' });
        const partialResponse = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-partial-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 2, size: '2048x1152' }
        });
        const partialRunId = partialResponse.json.run.id;
        await tick(baseUrl);
        setScenario({ error: 'unauthorized' });
        await tick(baseUrl);
        setScenario({ usage: 'present' });
        await tick(baseUrl);
        await tick(baseUrl);
        const partialRun = await findRun(projectAId, partialRunId, baseUrl);
        check('partial batch keeps first image', partialRun?.items.filter((item) => item.kind === 'image' && item.status === 'success').length === 1);
        check('failed second image is recorded', partialRun?.items.some((item) => item.kind === 'image' && item.status === 'failed'));
        check('partial batch status is partial', partialRun?.status === 'partial', partialRun?.status);
        check('failed image is not automatically retried', readMockLog().slice(-2).filter((item) => item.operation === 'edit').length === 2);

        // ---------- Review failure keeps image ----------
        setScenario({ reviewError: true, usage: 'present' });
        const reviewFailResponse = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-review-fail-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 1 }
        });
        const reviewFailRunId = reviewFailResponse.json.run.id;
        await tick(baseUrl);
        await tick(baseUrl);
        const reviewFailRun = await findRun(projectAId, reviewFailRunId, baseUrl);
        check('review failure keeps successful image', reviewFailRun?.items.some((item) => item.kind === 'image' && item.status === 'success'));
        check('review failure marks review unavailable', reviewFailRun?.items.some((item) => item.kind === 'review' && item.status === 'review_unavailable'));
        check('review failure does not regenerate image', readMockLog().at(-1)?.operation === 'edit');
        setScenario({ usage: 'present' });

        // ---------- Unknown result pauses subsequent calls ----------
        setScenario({ error: 'connection' });
        const unknownResponse = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-unknown-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 2 }
        });
        const unknownRunId = unknownResponse.json.run.id;
        const logBeforeUnknown = readMockLog().length;
        await tick(baseUrl);
        await tick(baseUrl);
        const unknownRun = await findRun(projectAId, unknownRunId, baseUrl);
        check('connection loss is unknown, not failed', unknownRun?.items[0]?.status === 'unknown');
        check('unknown result pauses the batch', unknownRun?.status === 'paused_unknown');
        check('unknown result does not start second image', readMockLog().length === logBeforeUnknown + 1);
        // Preserve an engine-produced fault response for isolated browser regression.
        fs.writeFileSync(path.join(artifactsDir, 'unknown-ui-fixture.json'), JSON.stringify(await detail(baseUrl, projectAId)));
        const stopUnknownResponse = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-unknown-stop-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 1 }
        });
        const stopUnknownRunId = stopUnknownResponse.json.run.id;
        const logBeforeStopUnknown = readMockLog().length;
        await tick(baseUrl);
        const pausedForStop = await findRun(projectAId, stopUnknownRunId, baseUrl);
        check('separate unknown run pauses', pausedForStop?.status === 'paused_unknown');
        await action(baseUrl, projectAId, 'run.stop', { runId: stopUnknownRunId });
        const stoppedUnknown = await findRun(projectAId, stopUnknownRunId, baseUrl);
        check('stop wins over paused_unknown', stoppedUnknown?.status === 'stopped', stoppedUnknown?.status);
        check('stopping an unknown run does not resend', readMockLog().length === logBeforeStopUnknown + 1);
        const logBeforeAbandon = readMockLog().length;
        const abandon = await action(baseUrl, projectAId, 'run.abandonUnknown', { runId: unknownRunId });
        check('abandon unknown is explicit and free', abandon.status === 200);
        check('abandon unknown does not resend', readMockLog().length === logBeforeAbandon);
        await action(baseUrl, projectAId, 'run.stop', { runId: unknownRunId });
        setScenario({ usage: 'present' });

        // ---------- Budget enforcement ----------
        const budgetResponse = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-budget-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 2 }
        });
        const budgetRunId = budgetResponse.json.run.id;
        const db = openDb();
        const budgetRow = db.prepare('SELECT snapshot_json FROM runs WHERE id = ?').get(budgetRunId);
        const budgetSnapshot = JSON.parse(budgetRow.snapshot_json);
        budgetSnapshot.estimate.estimatedImageUsd = 1;
        budgetSnapshot.estimate.imageCalls = 2;
        budgetSnapshot.estimate.totalCalls = 4;
        budgetSnapshot.authorization.budgetUsd = 0.4;
        db.prepare('UPDATE runs SET snapshot_json = ? WHERE id = ?').run(JSON.stringify(budgetSnapshot), budgetRunId);
        db.close();
        const logBeforeBudget = readMockLog().length;
        await tick(baseUrl);
        const budgetRun = await findRun(projectAId, budgetRunId, baseUrl);
        check('budget cap blocks next image', budgetRun?.items[0]?.errorCode === 'BUDGET_EXCEEDED' && budgetRun?.status === 'paused_budget', budgetRun?.items[0]?.errorCode);
        check('budget block does not call image API', readMockLog().length === logBeforeBudget);
        fs.writeFileSync(path.join(artifactsDir, 'budget-ui-fixture.json'), JSON.stringify(await detail(baseUrl, projectAId)));

        // ---------- Call limit enforcement ----------
        const limitResponse = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-call-limit-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 2 }
        });
        const limitRunId = limitResponse.json.run.id;
        const dbLimit = openDb();
        const limitRow = dbLimit.prepare('SELECT snapshot_json FROM runs WHERE id = ?').get(limitRunId);
        const limitSnapshot = JSON.parse(limitRow.snapshot_json);
        limitSnapshot.authorization.maxCalls = 1;
        limitSnapshot.authorization.maxImageOutputs = 2;
        dbLimit.prepare('UPDATE runs SET snapshot_json = ? WHERE id = ?').run(JSON.stringify(limitSnapshot), limitRunId);
        dbLimit.close();
        const logBeforeLimit = readMockLog().length;
        await tick(baseUrl);
        await tick(baseUrl);
        const limitRun = await findRun(projectAId, limitRunId, baseUrl);
        check(
            'call limit blocks the next paid step',
            limitRun?.status === 'paused_budget' &&
                limitRun?.items.some((item) => item.errorCode === 'CALL_LIMIT_EXCEEDED'),
            `${limitRun?.status} / ${limitRun?.items.map((item) => item.errorCode).join(',')}`
        );
        check('call limit allows no extra image call', readMockLog().length === logBeforeLimit + 1);

        // ---------- Missing usage pauses further paid calls ----------
        setScenario({ usage: 'missing' });
        const costUnknownResponse = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-cost-unknown-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 1 }
        });
        const costRunId = costUnknownResponse.json.run.id;
        const logBeforeCost = readMockLog().length;
        await tick(baseUrl);
        const costRun = await findRun(projectAId, costRunId, baseUrl);
        check('missing usage keeps image', costRun?.items.some((item) => item.kind === 'image' && item.status === 'success'));
        check(
            'missing usage pauses later paid calls',
            costRun?.status === 'paused_budget' && costRun?.errorCode === 'COST_UNKNOWN',
            `${costRun?.status} / ${costRun?.errorCode}`
        );
        check('missing usage does not retry image', readMockLog().length === logBeforeCost + 1);
        await action(baseUrl, projectAId, 'run.stop', { runId: costRunId });
        setScenario({ usage: 'present' });

        // ---------- Stop saves late result ----------
        setScenario({ delayMs: 1500, usage: 'present' });
        const stopResponse = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-stop-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 1 }
        });
        const stopRunId = stopResponse.json.run.id;
        const logBeforeStop = readMockLog().length;
        const stopTickPromise = tick(baseUrl);
        await sleep(400);
        const stopped = await action(baseUrl, projectAId, 'run.stop', { runId: stopRunId });
        check('stop is accepted while request is in flight', stopped.status === 200);
        await stopTickPromise;
        const stoppedRun = await findRun(projectAId, stopRunId, baseUrl);
        check('late successful result is saved', stoppedRun?.items.some((item) => item.kind === 'image' && item.status === 'success'));
        check('late result creates a version', (await detail(baseUrl, projectAId)).versions.length >= 1);
        check('stopped run does not start review', stoppedRun?.items.every((item) => item.kind !== 'review'));
        check('stopped run status is stopped', stoppedRun?.status === 'stopped', stoppedRun?.status);
        check('stop does not resend', readMockLog().length === logBeforeStop + 1);
        setScenario({ usage: 'present' });

        // ---------- Worker restart recovery keeps late result ----------
        setScenario({ delayMs: 2500, usage: 'present' });
        const recoverResponse = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-recover-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 1 }
        });
        const recoverRunId = recoverResponse.json.run.id;
        const logBeforeRecover = readMockLog().length;
        const recoverTick = tick(baseUrl);
        await sleep(600);
        const recoverCall = await workerPost(baseUrl, '/api/workbench/internal/recover');
        check('worker-start recovery is authenticated and reports sending item', recoverCall.status === 200 && recoverCall.json?.recovered >= 1, recoverCall.text);
        await recoverTick;
        const recoveredRun = await findRun(projectAId, recoverRunId, baseUrl);
        check('late result overwrites unknown without a resend', recoveredRun?.items.some((item) => item.kind === 'image' && item.status === 'success'));
        check('recovery did not create a new image call', readMockLog().length === logBeforeRecover + 1);
        await tick(baseUrl);
        setScenario({ usage: 'present' });
        const completedBefore = readMockLog().length;
        await workerPost(baseUrl, '/api/workbench/internal/recover');
        const idleTick = await tick(baseUrl);
        check('recovery does not rerun completed runs', idleTick.didWork === false && readMockLog().length === completedBefore);

        // ---------- Download safety through the real API ----------
        localHttp = http.createServer((request, response) => {
            if (request.url === '/ok.png') {
                response.writeHead(200, { 'content-type': 'image/png', 'content-length': fixtures.stylePng.length });
                response.end(fixtures.stylePng);
                return;
            }
            if (request.url === '/403') {
                response.writeHead(403, { 'content-type': 'text/plain' });
                response.end('forbidden');
                return;
            }
            if (request.url === '/html') {
                response.writeHead(200, { 'content-type': 'text/html' });
                response.end('<html><body>not an image</body></html>');
                return;
            }
            if (request.url === '/huge') {
                response.writeHead(200, { 'content-type': 'image/png', 'content-length': '999999999' });
                response.end();
                return;
            }
            response.writeHead(404);
            response.end();
        });
        await new Promise((resolve) => localHttp.listen(0, '127.0.0.1', resolve));
        const localPort = localHttp.address().port;
        const localBase = `http://127.0.0.1:${localPort}`;
        const db2 = openDb();
        const cases = [
            { url: `${localBase}/403`, label: 'download 403', expect: 'HTTP_ERROR' },
            { url: `${localBase}/html`, label: 'HTTP 200 HTML', expect: 'NOT_IMAGE' },
            { url: `${localBase}/huge`, label: 'oversize file', expect: 'TOO_LARGE' },
            { url: 'http://169.254.169.254/latest/meta-data', label: 'metadata address', expect: 'PRIVATE_ADDRESS' }
        ];
        for (const item of cases) {
            const candidateId = insertCandidate(db2, projectAId, item.url, `${localBase}/page`, item.label);
            const importResponse = await action(baseUrl, projectAId, 'candidate.import', { candidateId });
            check(`${item.label} is rejected with ${item.expect}`, importResponse.status === 422 && String(importResponse.json?.error).includes(item.expect), importResponse.text);
            const row = db2.prepare('SELECT status, error FROM search_candidates WHERE id = ?').get(candidateId);
            check(`${item.label} keeps real failed status`, row?.status === 'failed' && String(row?.error).includes(item.expect));
        }
        const okCandidateId = insertCandidate(db2, projectAId, `${localBase}/ok.png`, `${localBase}/page`, 'valid candidate');
        const okImport = await action(baseUrl, projectAId, 'candidate.import', { candidateId: okCandidateId });
        check('valid remote image imports by real bytes', okImport.status === 200 && okImport.json?.asset?.sha256 === fixtures.styleHash, okImport.text);
        db2.close();
        localHttp.close();
        localHttp = null;

        // ---------- Local input failure is known, not billable-unknown ----------
        const projectD = await createProject(baseUrl, '本地输入错误测试', 'keyword');
        const projectDId = projectD.project.id;
        const brokenAsset = await upload(
            baseUrl,
            projectDId,
            fs.readFileSync(path.join(fixtureDir, 'source-b.png')),
            'broken-source.png'
        );
        await action(baseUrl, projectDId, 'references.save', {
            bindings: [
                {
                    assetId: brokenAsset.asset.id,
                    purpose: 'character',
                    borrow: '角色外观',
                    exclude: '',
                    position: 0
                }
            ]
        });
        await action(baseUrl, projectDId, 'prompt.compile');
        const brokenRun = await action(baseUrl, projectDId, 'run.create', {
            actionId: `acceptance-local-input-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 1 }
        });
        const brokenRunId = brokenRun.json.run.id;
        const logBeforeBroken = readMockLog().length;
        fs.rmSync(path.join(dataDir, 'assets', brokenAsset.asset.filename), { force: true });
        await tick(baseUrl);
        const brokenRunDetail = await findRun(projectDId, brokenRunId, baseUrl);
        check(
            'missing local input is a known failure',
            brokenRunDetail?.items[0]?.status === 'failed' && brokenRunDetail?.items[0]?.errorCode === 'LOCAL_INPUT_ERROR',
            `${brokenRunDetail?.items[0]?.status} / ${brokenRunDetail?.items[0]?.errorCode}`
        );
        check('missing local input never reaches the image API', readMockLog().length === logBeforeBroken);

        // ---------- Worker process actually executes tasks ----------
        setScenario({ usage: 'present' });
        const workerEnv = {
            ...serverEnv(port),
            WORKBENCH_WORKER_URL: baseUrl,
            WORKBENCH_WORKER_TOKEN: token,
            WORKBENCH_DATA_DIR: dataDir,
            WORKBENCH_WORKER_INTERVAL_MS: '300'
        };
        const workerFd = fsSync.openSync(workerLogPath, 'a');
        worker = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'workbench-worker.mjs')], {
            cwd: repoRoot,
            env: { ...process.env, ...workerEnv },
            stdio: ['ignore', workerFd, workerFd]
        });
        const workerStartup = Date.now();
        while (Date.now() - workerStartup < 15000 && !fs.readFileSync(workerLogPath, 'utf8').includes('启动恢复完成')) {
            await sleep(300);
        }
        const workerRun = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-worker-${Date.now()}`,
            run: { ...genPayload.run, imageCount: 1 }
        });
        const workerRunId = workerRun.json.run.id;
        const finished = await waitForRunStatus(baseUrl, projectAId, workerRunId, ['completed', 'partial', 'failed', 'paused_unknown', 'paused_budget'], 40000);
        check('worker executes a queued run without an open page', finished?.status === 'completed', finished?.status);
        check('worker log shows completed step', fs.readFileSync(workerLogPath, 'utf8').includes('完成一步'));
        await stopProcess(worker);
        worker = null;
        const callsBeforeWorkerRestart = readMockLog().length;
        worker = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'workbench-worker.mjs')], {
            cwd: repoRoot,
            env: { ...process.env, ...workerEnv },
            stdio: ['ignore', workerFd, workerFd]
        });
        await sleep(3000);
        check('worker restart does not rerun completed work', readMockLog().length === callsBeforeWorkerRestart);
        await stopProcess(worker);
        worker = null;
        try {
            fsSync.closeSync(workerFd);
        } catch {
            // ignore
        }

        // ---------- A single reroll must not repeat the successful sibling ----------
        const callsBeforeSingle = readMockLog().length;
        const beforeSingleDetail = await detail(baseUrl, projectAId);
        const originalSnapshot = beforeSingleDetail.runs.find((run) => run.id === genRunId).snapshot;
        const singleRerollResponse = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-single-reroll-${Date.now()}`,
            run: { action: 'reroll', sourceRunId: genRunId, imageCount: 1, budgetUsd: 1, riskAcknowledged: true }
        });
        const singleReroll = singleRerollResponse.json?.run;
        check('one-image reroll creates exactly one image item', singleRerollResponse.status === 200 && singleReroll?.items.filter((item) => item.kind === 'image').length === 1, singleRerollResponse.text);
        checkEqual('one-image reroll snapshot keeps original inputs and changes only count', {
            prompt: singleReroll?.snapshot.prompt,
            avoid: singleReroll?.snapshot.avoid,
            references: singleReroll?.snapshot.references,
            params: singleReroll?.snapshot.params
        }, {
            prompt: originalSnapshot.prompt,
            avoid: originalSnapshot.avoid,
            references: originalSnapshot.references,
            params: { ...originalSnapshot.params, imageCount: 1 }
        });
        check('one-image reroll authorizes one image and one review', singleReroll?.snapshot.authorization.maxImageOutputs === 1 && singleReroll?.snapshot.authorization.maxCalls === 2);
        const singleTicks = await drain(baseUrl);
        check('one-image reroll executes one image and one review', singleTicks.filter((item) => item.didWork).length === 2, JSON.stringify(singleTicks));
        checkEqual('one-image reroll reaches image provider exactly once', readMockLog().length, callsBeforeSingle + 1);
        const afterSingleDetail = await detail(baseUrl, projectAId);
        checkEqual('one-image reroll preserves source snapshot', afterSingleDetail.runs.find((run) => run.id === genRunId).snapshot, originalSnapshot);
        checkEqual('one-image reroll adds only one version', afterSingleDetail.versions.length, beforeSingleDetail.versions.length + 1);
        const rejectedExpansion = await action(baseUrl, projectAId, 'run.create', {
            actionId: `acceptance-expand-single-${Date.now()}`,
            run: { action: 'reroll', sourceRunId: singleReroll.id, imageCount: 2, budgetUsd: 1, riskAcknowledged: true }
        });
        check('one-image source cannot silently expand to two requests', rejectedExpansion.status === 400 && rejectedExpansion.json?.code === 'INVALID_IMAGE_COUNT', rejectedExpansion.text);
        for (const invalidCount of [null, 0, 3, '1']) {
            const rejectedCount = await action(baseUrl, projectAId, 'run.create', {
                actionId: `acceptance-invalid-reroll-${Date.now()}-${String(invalidCount)}`,
                run: { action: 'reroll', sourceRunId: genRunId, imageCount: invalidCount, budgetUsd: 1, riskAcknowledged: true }
            });
            check(`reroll rejects invalid image count ${JSON.stringify(invalidCount)}`, rejectedCount.status === 400 && rejectedCount.json?.code === 'INVALID_IMAGE_COUNT', rejectedCount.text);
        }
        checkEqual('rejected reroll expansion sends no image request', readMockLog().length, callsBeforeSingle + 1);

        // ---------- Secrets and bundle ----------
        const distDir = path.join(repoRoot, process.env.NEXT_DIST_DIR || '.next');
        const staticDir = fs.existsSync(path.join(distDir, 'dev', 'static'))
            ? path.join(distDir, 'dev', 'static') : path.join(distDir, 'static');
        const jsFiles = [];
        const walk = (dir) => {
            let entries = [];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name.endsWith('.js')) jsFiles.push(full);
            }
        };
        walk(staticDir);
        const needles = ['process.env.OPENAI_API_KEY', 'Authorization: Bearer', 'sk-proj-', 'sk-svcacct-'];
        const bundleHits = [];
        for (const file of jsFiles) {
            const content = fs.readFileSync(file, 'utf8');
            for (const needle of needles) {
                if (content.includes(needle)) bundleHits.push({ file: path.relative(repoRoot, file), needle });
            }
        }
        check('client bundle scanned', jsFiles.length > 0, `scanned ${jsFiles.length}`);
        checkEqual('client bundle contains no key material', bundleHits, []);
        const serverLog = fs.readFileSync(serverLogPath, 'utf8');
        const workerLog = fs.readFileSync(workerLogPath, 'utf8');
        check('server log contains no token', !serverLog.includes(token));
        check('worker log contains no token value', !workerLog.includes(token));
        check('server log contains no key material', !/sk-proj-|sk-svcacct-|Authorization:\s*Bearer/i.test(serverLog));

        // ---------- Screenshot evidence (isolated fixtures) ----------
        const screenshotOk = screenshot(`${baseUrl}/workbench?project=${projectAId}`, 'workbench-fixture.png');
        check('isolated fixture screenshot captured', screenshotOk, screenshotDir);
        const homeScreenshot = screenshot(baseUrl, 'home-fixture.png');
        check('legacy entry screenshot captured', homeScreenshot, screenshotDir);

        // Ordinary runtime must neither expose nor execute historical fixture projects.
        const beforeArchiveDb = openDb();
        const archiveBefore = beforeArchiveDb.prepare('SELECT id, status FROM run_items ORDER BY id').all();
        const projectCountBefore = beforeArchiveDb.prepare('SELECT COUNT(*) AS count FROM projects').get().count;
        beforeArchiveDb.close();
        await stopProcess(server.child);
        fsSync.closeSync(server.logFd);
        server = null;
        server = await startServer(port, {
            NEXT_DIST_DIR: `${process.env.NEXT_DIST_DIR || '.next'}-ordinary`,
            WORKBENCH_TEST_FIXTURES: '', IMAGE_API_TEST_FIXTURE_DIR: ''
        });
        const ordinaryList = await api(baseUrl, '/api/workbench/projects');
        checkEqual('ordinary runtime hides historical fixture projects', ordinaryList.json?.projects, []);
        const archivedDetail = await api(baseUrl, `/api/workbench/projects/${projectAId}`);
        check('historical fixture detail is unavailable to ordinary runtime', archivedDetail.status === 404);
        const logBeforeArchivedAction = readMockLog().length;
        const archivedAction = await action(baseUrl, projectAId, 'run.create', {
            actionId: `blocked-archived-${Date.now()}`, run: genPayload.run
        });
        check('historical fixture cannot create a real paid run', archivedAction.status === 404 || (archivedAction.status === 409 && archivedAction.json?.code === 'TEST_DATA_NOT_EXECUTABLE'), archivedAction.text);
        checkEqual('archived action sends no image request', readMockLog().length, logBeforeArchivedAction);
        const afterArchiveDb = openDb();
        checkEqual('historical task records are preserved', afterArchiveDb.prepare('SELECT id, status FROM run_items ORDER BY id').all(), archiveBefore);
        checkEqual('historical projects are preserved', afterArchiveDb.prepare('SELECT COUNT(*) AS count FROM projects').get().count, projectCountBefore);
        afterArchiveDb.close();

    } finally {
        if (worker) await stopProcess(worker);
        if (localHttp) localHttp.close();
        if (server) {
            await stopProcess(server.child);
            try {
                fsSync.closeSync(server.logFd);
            } catch {
                // ignore
            }
        }
    }

    console.log('\n============ WORKBENCH ACCEPTANCE SUMMARY ============');
    console.log(`PASS: ${passed.length}`);
    console.log(`FAIL: ${failed.length}`);
    if (failed.length > 0) {
        for (const item of failed) console.log(`- ${item.name}: ${String(item.detail ?? '').slice(0, 300)}`);
        console.log(`Artifacts kept at: ${path.relative(repoRoot, artifactsDir)}`);
        process.exit(1);
    }
    console.log('All workbench no-real-API acceptance checks passed.');
    console.log(`Artifacts: ${path.relative(repoRoot, artifactsDir)}`);
}

await main();
