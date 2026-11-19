import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { serializeConfig } from '../config-policy.mjs';
import { verifyFallback } from '../verify-fallback.mjs';

function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'p0tion-fallback-test-')));
    const stage = path.join(root, 'packages/backend/.fallback-stage');
    const proofDirectory = path.join(root, '.packaging-evidence/code-fallback');
    fs.mkdirSync(path.join(stage, 'dist'), { recursive: true });
    fs.mkdirSync(proofDirectory, { recursive: true });
    const config = JSON.parse(fs.readFileSync(new URL('./fixtures/config.json', import.meta.url)));
    const data = { 'package.json': JSON.stringify({ engines: { node: '22' } }),
        'pnpm-lock.yaml': 'synthetic-lock', 'dist/index.cjs.js': '// synthetic bundle',
        '.env': serializeConfig(config) };
    const files = {};
    for (const [name, text] of Object.entries(data)) {
        fs.writeFileSync(path.join(stage, name), text);
        files[name] = crypto.createHash('sha256').update(text).digest('hex');
    }
    fs.writeFileSync(path.join(proofDirectory, 'provenance.json'), JSON.stringify({ kind: 'code-only-fallback', files }));
    return { root, stage };
}

test('fallback verifies immutable inventory and hashes, rejects tampering and extra credential files', () => {
    const { root, stage } = fixture();
    try {
        assert.deepEqual(verifyFallback(root), { kind: 'code-only-fallback', filesVerified: 4, restoresNode18: false });
        fs.writeFileSync(path.join(stage, '.env.secret'), 'FAKE_SECRET');
        assert.throws(() => verifyFallback(root));
        fs.unlinkSync(path.join(stage, '.env.secret'));
        fs.appendFileSync(path.join(stage, 'dist/index.cjs.js'), '\n// tampered');
        assert.throws(() => verifyFallback(root));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fallback rejects symlinked artifacts', () => {
    const { root, stage } = fixture();
    try {
        fs.unlinkSync(path.join(stage, 'dist/index.cjs.js'));
        fs.symlinkSync(path.join(stage, 'package.json'), path.join(stage, 'dist/index.cjs.js'));
        assert.throws(() => verifyFallback(root));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
