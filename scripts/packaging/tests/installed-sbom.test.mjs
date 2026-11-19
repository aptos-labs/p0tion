import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateSbom, installedInventory, npmPurl } from '../installed-sbom.mjs';

function fixture(t) {
    const base = new URL('./.temp/', import.meta.url);
    fs.mkdirSync(base, { recursive: true });
    const project = fs.mkdtempSync(path.join(fs.realpathSync(base), 'installed-'));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    fs.mkdirSync(path.join(project, 'node_modules'));
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'fixture-app', version: '1.0.0' }));
    function pkg(relative, name, version) {
        const dir = path.join(project, 'node_modules', relative);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
        return dir;
    }
    return { project, pkg };
}

test('actual installed manifests: scoped, nested versions, pnpm symlinks, deduplication and deterministic flat CycloneDX 1.5', t => {
    const { project, pkg } = fixture(t);
    pkg('plain', 'plain', '1.0.0');
    pkg('plain/node_modules/duplicate', 'duplicate', '1.0.0');
    pkg('duplicate', 'duplicate', '2.0.0');
    pkg('@scope/scoped', '@scope/scoped', '3.0.0');
    const linked = pkg('.pnpm/linked@4.0.0/node_modules/linked', 'linked', '4.0.0');
    fs.symlinkSync(path.relative(path.join(project, 'node_modules'), linked), path.join(project, 'node_modules/linked'));
    pkg('.store/real-target', '@other/linked', '5.0.0');
    fs.mkdirSync(path.join(project, 'node_modules/@other'));
    fs.symlinkSync('../.store/real-target', path.join(project, 'node_modules/@other/linked'));
    // Not a package root; must not count shipped example manifests.
    pkg('plain/examples/example', 'not-installed', '99.0.0');
    fs.mkdirSync(path.join(project, 'node_modules/.bin'));
    fs.symlinkSync('/nonexistent-command', path.join(project, 'node_modules/.bin/command'));
    const hashes = { 'dist/index.cjs.js': 'a'.repeat(64) };
    const bom = generateSbom(project, hashes);
    assert.equal(JSON.stringify(generateSbom(project, hashes)), JSON.stringify(bom));
    assert.equal(bom.bomFormat, 'CycloneDX');
    assert.equal(bom.specVersion, '1.5');
    assert.equal(bom.components.length, 6);
    assert.equal(new Set(bom.components.map(c => c['bom-ref'])).size, 6);
    assert(!('dependencies' in bom));
    assert.equal(npmPurl('@scope/scoped', '3.0.0'), 'pkg:npm/%40scope/scoped@3.0.0');
    assert.equal(bom.components.filter(c => c.name === 'duplicate').length, 2);
    for (const c of bom.components) {
        assert.equal(c.type, 'library');
        assert.match(c.purl, /^pkg:npm\//);
        assert.match(c.properties.find(p => p.name === 'p0tion:package-json-sha256').value, /^[a-f0-9]{64}$/);
    }
    assert(bom.metadata.properties.some(p => p.value.includes('reachability not assessed')));
    assert(bom.metadata.properties.some(p => p.value === hashes['dist/index.cjs.js']));
});

test('escaping nested and scoped links fail closed before target manifests are read', t => {
    for (const relative of ['escape', '@scope/escape', 'plain/node_modules/escape']) {
        const { project, pkg } = fixture(t);
        pkg('plain', 'plain', '1.0.0');
        const link = path.join(project, 'node_modules', relative);
        fs.mkdirSync(path.dirname(link), { recursive: true });
        fs.symlinkSync(project, link);
        assert.throws(() => installedInventory(project), /escapes install boundary/);
    }
});

test('reject parent symlinks, missing identities and package.json symlinks', t => {
    const { project, pkg } = fixture(t);
    const dir = pkg('plain', 'plain', '1.0.0');
    const alias = project + '-alias';
    fs.symlinkSync(project, alias);
    t.after(() => fs.unlinkSync(alias));
    assert.throws(() => installedInventory(alias), /Symlink/);
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    assert.throws(() => installedInventory(project), /Invalid installed package name/);
    fs.unlinkSync(path.join(dir, 'package.json'));
    fs.symlinkSync(path.join(project, 'package.json'), path.join(dir, 'package.json'));
    assert.throws(() => installedInventory(project), /package.json symlink forbidden/);
});
