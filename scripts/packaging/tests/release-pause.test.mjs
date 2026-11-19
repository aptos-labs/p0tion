import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assertReleaseAllowed } from '../release-production.mjs';

test('owner pause blocks release/fallback preflight without making any cloud call', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p0tion-pause-test-'));
    try {
        assert.doesNotThrow(() => assertReleaseAllowed(root));
        const directory = path.join(root, '.packaging-evidence');
        fs.mkdirSync(directory);
        const marker = path.join(directory, 'callable-pause-active.json');
        fs.writeFileSync(marker, JSON.stringify({ active: true }));
        assert.throws(() => assertReleaseAllowed(root), /owner-paused/);
        fs.writeFileSync(marker, JSON.stringify({ active: false }));
        assert.doesNotThrow(() => assertReleaseAllowed(root));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
