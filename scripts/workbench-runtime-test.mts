import { getWorkbenchDataDir, isWorkbenchFixtureTest } from '../src/lib/workbench/config.ts';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const keys = [
    'NODE_ENV',
    'OPENAI_API_KEY',
    'WORKBENCH_MOCK',
    'WORKBENCH_TEST_FIXTURES',
    'WORKBENCH_TEST_STRICT_AUTHORIZATION',
    'WORKBENCH_DATA_DIR'
];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const valid = {
    NODE_ENV: 'development',
    OPENAI_API_KEY: '',
    WORKBENCH_MOCK: '',
    WORKBENCH_TEST_FIXTURES: '1',
    WORKBENCH_TEST_STRICT_AUTHORIZATION: '1',
    WORKBENCH_DATA_DIR: path.resolve('test-artifacts/runtime-guard-test')
};
let checks = 0;
function rejects(overrides: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries({ ...valid, ...overrides })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    assert.throws(() => isWorkbenchFixtureTest());
    checks++;
}
try {
    Object.assign(process.env, valid);
    assert.equal(isWorkbenchFixtureTest(), true);
    checks++;
    rejects({ NODE_ENV: 'production' });
    rejects({ OPENAI_API_KEY: 'not-a-real-test-key' });
    rejects({ OPENAI_API_KEY: undefined });
    rejects({ WORKBENCH_TEST_STRICT_AUTHORIZATION: '' });
    rejects({ WORKBENCH_DATA_DIR: '' });
    rejects({ WORKBENCH_DATA_DIR: path.resolve('.workbench-data') });
    rejects({ WORKBENCH_DATA_DIR: path.resolve('test-artifacts') });
    rejects({ WORKBENCH_DATA_DIR: path.resolve('test-artifacts/../.workbench-data') });
    rejects({ WORKBENCH_MOCK: '1' });
    Object.assign(process.env, valid, { WORKBENCH_TEST_FIXTURES: '', WORKBENCH_DATA_DIR: '' });
    assert.equal(isWorkbenchFixtureTest(), false);
    checks++;
    assert.equal(getWorkbenchDataDir(), path.resolve('.workbench-data'));
    checks++;
    for (const testCase of [
        { args: ['--mock'], oldFlag: '' },
        { args: [], oldFlag: '1' }
    ]) {
        const result = spawnSync(process.execPath, ['scripts/start-local.mjs', ...testCase.args], {
            encoding: 'utf8',
            timeout: 10000,
            env: { ...process.env, OPENAI_API_KEY: '', ENABLE_IMAGE_API: 'false', WORKBENCH_MOCK: testCase.oldFlag }
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /模拟运行模式已移除/);
        assert.doesNotMatch(result.stdout, /本地访问地址|worker.*启动/);
        checks++;
    }
    console.log(
        `PASS ${checks} runtime guards: retired switches rejected, test providers isolated, real data path preserved.`
    );
} finally {
    for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
    }
}
