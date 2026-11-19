import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT, CLI_VERSION, FUNCTIONS, deployArgs, main } from '../release-production.mjs';

test('production release fixes project, pinned CLI and exact eleven-function scope', () => {
    assert.equal(PROJECT, 'aptos-p0tion-dev');
    assert.equal(CLI_VERSION, '15.34.1');
    assert.equal(FUNCTIONS.length, 11);
    assert.equal(new Set(FUNCTIONS).size, 11);
    const selected = deployArgs[deployArgs.indexOf('--only') + 1].split(',');
    assert.deepEqual(selected, FUNCTIONS.map(name => `functions:${name}`));
    assert.ok(!selected.includes('functions'));
    assert.ok(!deployArgs.includes('--force'));
    assert.ok(!deployArgs.includes('--dry-run'));
});

test('default plan makes no Firebase call and execution requires explicit switch', () => {
    const original = console.log;
    const output = [];
    console.log = value => output.push(JSON.parse(value));
    try { main([]); main(['--plan']); main(['--plan-fallback']); } finally { console.log = original; }
    assert.equal(output.length, 3);
    assert.equal(output[2].fallback, true);
    assert.ok(output[2].arguments.includes('firebase.fallback.json'));
    assert.equal(output[2].restoresNode18, false);
    assert.ok(output.every(plan => plan.executed === false && plan.production));
    for (const args of [['--project', 'other'], ['--execute', '--force'], ['--dry-run']]) {
        assert.throws(() => main(args));
    }
});
