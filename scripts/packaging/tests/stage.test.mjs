import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { serializeConfig, configRelative } from '../config-policy.mjs';
const configFixture = JSON.parse(fs.readFileSync(new URL('./fixtures/config.json', import.meta.url)));
import { prune, createStage, verify, stageRelative } from '../stage.mjs';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/graph.json', import.meta.url)));
const clone = () => structuredClone(fixture);
test('production reachability prunes orphans/dev-only; preserves shared, peers, optional and registry', () => {
  const { manifest, lock } = clone();
  const before = JSON.stringify(lock);
  const result = prune(manifest, lock);
  assert.deepEqual(Object.keys(result.importers), ['.']);
  assert(!result.importers['.'].devDependencies);
  assert.equal(result.importers['.'].dependencies['@aptos-labs/zk-actions'].version, '0.0.2(peer@1.0.0)');
  assert.equal(Object.keys(result.packages).length, 5);
  for (const key of Object.keys(result.packages)) {
    assert.deepEqual(result.packages[key], { ...lock.packages[key], dev: false });
  }
  assert.equal(JSON.stringify(lock), before);
});
test('local/workspace dependencies explicitly fail closed, including transitive links', () => {
  for (const protocol of ['workspace:', 'link:', 'file:']) {
    const { manifest, lock } = clone();
    manifest.dependencies.runtime = `${protocol}../runtime`;
    lock.importers['packages/backend'].dependencies.runtime.specifier = manifest.dependencies.runtime;
    assert.throws(() => prune(manifest, lock), /unsupported/);
  }
  const { manifest, lock } = clone();
  lock.packages['/runtime@1.0.0'].dependencies.shared = 'link:../shared';
  assert.throws(() => prune(manifest, lock), /unsupported/);
});
test('unknown formats, unresolved nodes, specifier and integrity drift fail closed', () => {
  for (const mutate of [
    x => { x.lock.lockfileVersion = '9.0'; },
    x => { delete x.lock.packages['/shared@1.0.0']; },
    x => { delete x.lock.packages['/peer@1.0.0'].resolution.integrity; },
    x => { x.lock.importers['packages/backend'].dependencies.runtime.specifier = '^1'; },
    x => { x.lock.overrides = {}; }
  ]) {
    const x = clone(); mutate(x); assert.throws(() => prune(x.manifest, x.lock));
  }
});
function setup(t) {
  const repo = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'p0tion-fixture-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, 'packages/backend/dist'), { recursive: true });
  const { manifest, lock } = clone();
  Object.assign(manifest, { name: 'fixture', version: '1.0.0', main: './dist/index.cjs.js', scripts: { prepare: 'exit 97' } });
  fs.writeFileSync(path.join(repo, 'packages/backend/package.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(repo, 'pnpm-lock.yaml'), YAML.stringify(lock));
  fs.writeFileSync(path.join(repo, 'packages/backend/dist/index.cjs.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(repo, configRelative), JSON.stringify(configFixture));
  return repo;
}
test('allowlist excludes source maps, tests, secrets; bytes reproducible; verifier rejects stale/extra files', t => {
  const repo = setup(t);
  const backend = path.join(repo, 'packages/backend');
  // Synthetic markers ONLY, not real credentials.
  for (const name of ['.env', 'serviceAccountKey.json', 'dist/index.cjs.js.map', 'dist/secret.json']) fs.writeFileSync(path.join(backend, name), 'synthetic excluded marker');
  const first = createStage(repo);
  assert.deepEqual(createStage(repo), first);
  assert.equal(Object.keys(first).length, 4);
  assert.equal(fs.readFileSync(path.join(repo, stageRelative, '.env'), 'utf8'), serializeConfig(configFixture));
  const staged = JSON.parse(fs.readFileSync(path.join(repo, stageRelative, 'package.json')));
  assert(!staged.scripts && !staged.devDependencies);
  fs.writeFileSync(path.join(repo, stageRelative, '.env'), 'tampered');
  assert.throws(() => verify(repo), /Stale/);
  createStage(repo);
  fs.writeFileSync(path.join(repo, stageRelative, '.env.local'), 'synthetic');
  assert.throws(() => verify(repo), /extra files/);
  assert.throws(() => createStage(repo), /unknown stage entry/);
  assert.equal(fs.readFileSync(path.join(repo, stageRelative, '.env.local'), 'utf8'), 'synthetic');
  fs.unlinkSync(path.join(repo, stageRelative, '.env.local'));
  createStage(repo);
  fs.appendFileSync(path.join(backend, 'dist/index.cjs.js'), '// changed');
  assert.throws(() => verify(repo), /Stale/);
});
test('input and stage symlinks forbidden without reading their targets', t => {
  const repo = setup(t);
  const runtime = path.join(repo, 'packages/backend/dist/index.cjs.js');
  fs.unlinkSync(runtime); fs.symlinkSync('/nonexistent-secret-target', runtime);
  assert.throws(() => createStage(repo), /Symlink/);
  fs.unlinkSync(runtime); fs.writeFileSync(runtime, 'module.exports = {};');
  createStage(repo);
  fs.symlinkSync('/nonexistent-secret-target', path.join(repo, stageRelative, 'extra'));
  assert.throws(() => verify(repo), /symlink/i);
  fs.rmSync(path.join(repo, stageRelative), { recursive: true });
  fs.symlinkSync('/nonexistent-secret-target', path.join(repo, stageRelative));
  assert.throws(() => createStage(repo));
});
test('Firebase deploy config disables second isolation and gates with verifier, not build', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../../../packages/backend/firebase.deploy.json', import.meta.url)));
  assert.equal(config.functions.isolate, false);
  assert.equal(config.functions.source, '.deploy-stage');
  assert.match(config.functions.predeploy, /stage\.mjs.*verify$/);
  assert(!config.functions.predeploy.includes('build'));
});

test('stage replacement refuses unknown directories and rejects every symlink parent', t => {
    const repo = setup(t);
    createStage(repo);
    fs.mkdirSync(path.join(repo, stageRelative, 'unknown-empty-directory'));
    assert.throws(() => createStage(repo), /unknown stage entry/);
    assert(fs.existsSync(path.join(repo, stageRelative, 'unknown-empty-directory')));
    fs.rmdirSync(path.join(repo, stageRelative, 'unknown-empty-directory'));
    const alias = repo + '-alias';
    t.after(() => fs.unlinkSync(alias));
    fs.symlinkSync(repo, alias);
    assert.throws(() => createStage(alias), /Symlink/);
    assert.throws(() => verify(alias), /Symlink/);
    const packages = path.join(repo, 'packages');
    fs.renameSync(packages, packages + '-real');
    fs.symlinkSync(packages + '-real', packages);
    assert.throws(() => createStage(repo), /Symlink/);
    assert.throws(() => verify(repo), /Symlink/);
});

test('required config fails before deletion and verify rereads config', t => {
  const repo = setup(t); createStage(repo);
  const envPath = path.join(repo, stageRelative, '.env');
  const before = fs.readFileSync(envPath);
  fs.unlinkSync(path.join(repo, configRelative));
  assert.throws(() => createStage(repo), /ENOENT/);
  assert.deepEqual(fs.readFileSync(envPath), before);
  fs.writeFileSync(path.join(repo, configRelative), JSON.stringify({...configFixture, AWS_REGION: 'eu-west-1'}));
  assert.throws(() => verify(repo), /Stale/);
  fs.writeFileSync(path.join(repo, configRelative), JSON.stringify({...configFixture, AWS_SECRET_ACCESS_KEY: 'synthetic'}));
  assert.throws(() => createStage(repo));
  assert.deepEqual(fs.readFileSync(envPath), before);
  fs.unlinkSync(path.join(repo, configRelative));
  fs.symlinkSync('/nonexistent-secret-target', path.join(repo, configRelative));
  assert.throws(() => createStage(repo), /Symlink/);
});
