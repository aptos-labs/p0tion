import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CONFIG_KEYS, serializeConfig } from '../config-policy.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/config.json', import.meta.url)));

test('configuration serializes deterministically with exactly the approved keys', () => {
    assert.deepEqual(serializeConfig(fixture).trimEnd().split('\n').map(line => line.split('=')[0]), CONFIG_KEYS);
    assert.equal(serializeConfig(fixture), serializeConfig(Object.fromEntries(Object.entries(fixture).reverse())));
});

test('missing, extra and credential keys fail closed', () => {
    for (const key of CONFIG_KEYS) {
        const missing = { ...fixture };
        delete missing[key];
        assert.throws(() => serializeConfig(missing));
    }
    for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_ACCESS_TOKEN', 'OTHER']) {
        assert.throws(() => serializeConfig({ ...fixture, [key]: 'synthetic' }));
    }
    for (const invalid of [null, [], 'string']) assert.throws(() => serializeConfig(invalid));
});

test('empty values and dotenv injection are rejected', () => {
    for (const value of ['', ' ', 'x\nAWS_SECRET_ACCESS_KEY=fake', 'x\r', 'x#comment', '$TOKEN', '"quoted"', 'x\\y', 'x=y', 1]) {
        assert.throws(() => serializeConfig({ ...fixture, AWS_REGION: value }));
    }
    for (const value of ['0', '-1', '1.5', 'abc']) {
        assert.throws(() => serializeConfig({ ...fixture, AWS_PRESIGNED_URL_EXPIRATION: value }));
    }
});
