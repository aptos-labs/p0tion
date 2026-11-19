import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractNonsecretConfig } from '../extract-nonsecret-config.mjs';
import { FUNCTIONS } from '../release-production.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/config.json', import.meta.url)));

function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p0tion-config-test-'));
    const input = path.join(root, 'raw');
    fs.mkdirSync(input);
    for (const name of FUNCTIONS) {
        fs.writeFileSync(path.join(input, `${name}.json`), JSON.stringify({ ...fixture,
            AWS_ACCESS_KEY_ID: 'FAKE_CREDENTIAL', AWS_SECRET_ACCESS_KEY: 'FAKE_SECRET',
            GITHUB_ACCESS_TOKEN: 'FAKE_TOKEN', OTHER: 'ignored' }));
    }
    return { root, input, output: path.join(root, 'nonsecret') };
}

test('extracts exact allowlist, preserves originals, never includes secrets in report or outputs', () => {
    const dirs = setup();
    try {
        const report = extractNonsecretConfig(dirs.input, dirs.output);
        assert.equal(report.allConsistent, true);
        assert.equal(report.functions, 11);
        assert.equal(report.keysPerFunction, 10);
        for (const name of FUNCTIONS) {
            assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dirs.output, `${name}.json`))), fixture);
            assert.ok(fs.readFileSync(path.join(dirs.input, `${name}.json`), 'utf8').includes('FAKE_SECRET'));
        }
        assert.ok(!JSON.stringify(report).includes('FAKE'));
        assert.throws(() => extractNonsecretConfig(dirs.input, dirs.output));
    } finally { fs.rmSync(dirs.root, { recursive: true, force: true }); }
});

test('reports differing key names only and rejects incomplete configuration before output', () => {
    const dirs = setup();
    try {
        const source = path.join(dirs.input, 'createBucket.json');
        const config = JSON.parse(fs.readFileSync(source));
        config.AWS_REGION = 'eu-west-1';
        fs.writeFileSync(source, JSON.stringify(config));
        const report = extractNonsecretConfig(dirs.input, dirs.output);
        assert.deepEqual(report.differences, [{ function: 'createBucket', differingKeys: ['AWS_REGION'] }]);
        assert.ok(!JSON.stringify(report).includes('eu-west-1'));
        delete config.AWS_AMI_ID;
        fs.writeFileSync(source, JSON.stringify(config));
        const second = path.join(dirs.root, 'second');
        assert.throws(() => extractNonsecretConfig(dirs.input, second));
        assert.ok(!fs.existsSync(second));
    } finally { fs.rmSync(dirs.root, { recursive: true, force: true }); }
});
