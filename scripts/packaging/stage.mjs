import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { configRelative, serializeConfig } from './config-policy.mjs';

export const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
);
export const stageRelative = 'packages/backend/.deploy-stage';
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
export function rejectParentSymlinks(filename) {
    const resolved = path.resolve(filename);
    let current = path.parse(resolved).root;
    for (const part of resolved.slice(current.length).split(path.sep)) {
        current = path.join(current, part);
        const stat = fs.lstatSync(current, { throwIfNoEntry: false });
        if (!stat) break;
        assert(!stat.isSymbolicLink(), `Symlink forbidden: ${current}`);
    }
}
function safeFile(filename) {
    rejectParentSymlinks(filename);
    assert(fs.statSync(filename).isFile(), `Not a regular file: ${filename}`);
    return fs.readFileSync(filename);
}
export function prune(manifest, lock, importerId = 'packages/backend') {
    assert.equal(
        String(lock.lockfileVersion),
        '6.1',
        'Only pnpm lock v6.1 supported',
    );
    assert.deepEqual(
        Object.keys(lock).filter(
            (k) =>
                ![
                    'lockfileVersion',
                    'settings',
                    'importers',
                    'packages',
                ].includes(k),
        ),
        [],
        'Unsupported lock metadata; review explicitly',
    );
    const original = lock.importers[importerId];
    assert(original, 'Missing backend importer');
    const importer = {};
    for (const group of ['dependencies', 'optionalDependencies']) {
        const expected = manifest[group] || {};
        const entries = original[group] || {};
        assert.deepEqual(
            Object.keys(entries).sort(),
            Object.keys(expected).sort(),
            `${group} manifest/lock mismatch`,
        );
        if (Object.keys(entries).length)
            importer[group] = structuredClone(entries);
        for (const [name, entry] of Object.entries(entries)) {
            assert.equal(
                entry.specifier,
                expected[name],
                `Specifier drift: ${name}`,
            );
            assert(
                !/^(workspace:|link:|file:)/.test(entry.specifier),
                'Local/workspace dependencies unsupported; fail closed',
            );
        }
    }
    const selected = new Set();
    function visit(name, ref) {
        assert.equal(typeof ref, 'string');
        assert(
            !/^(workspace:|link:|file:)/.test(ref),
            'Local/workspace resolution unsupported; fail closed',
        );
        const key = ref.startsWith('/') ? ref : `/${name}@${ref}`;
        assert(
            own(lock.packages || {}, key),
            `Missing registry snapshot: ${key}`,
        );
        if (selected.has(key)) return;
        selected.add(key);
        const snapshot = lock.packages[key];
        assert(snapshot.resolution?.integrity, `Missing integrity: ${key}`);
        assert(
            !snapshot.resolution.directory && !snapshot.resolution.type,
            `Non-registry snapshot: ${key}`,
        );
        if (snapshot.resolution.tarball) {
            const url = new URL(snapshot.resolution.tarball);
            assert(
                url.protocol === 'https:' && !url.username && !url.password,
                'Unsafe tarball URL',
            );
        }
        // pnpm v6 peer-qualified snapshots contain installed peers in these edges.
        // peerDependencies/transitivePeerDependencies are metadata, not new resolutions.
        for (const group of ['dependencies', 'optionalDependencies']) {
            for (const [child, version] of Object.entries(
                snapshot[group] || {},
            ))
                visit(child, version);
        }
    }
    for (const entries of Object.values(importer))
        for (const [name, entry] of Object.entries(entries))
            visit(name, entry.version);
    const packages = {};
    for (const key of [...selected].sort()) {
        packages[key] = structuredClone(lock.packages[key]);
        // A snapshot shared with other importers can have dev:true; reachability,
        // not stale flags, establishes production membership. Preserve optional flags.
        packages[key].dev = false;
    }
    return {
        lockfileVersion: lock.lockfileVersion,
        ...(lock.settings ? { settings: structuredClone(lock.settings) } : {}),
        importers: { '.': importer },
        packages,
    };
}
export function expectedFiles(repo = root) {
    // Required for production staging; never fall back to a source .env or process.env.
    // Validate before any stage deletion and reread on every verification.
    const config = Buffer.from(serializeConfig(JSON.parse(
        safeFile(path.join(repo, configRelative)).toString(),
    )));
    const backend = path.join(repo, 'packages/backend');
    const manifest = JSON.parse(safeFile(path.join(backend, 'package.json')));
    assert.equal(
        manifest.dependencies['@aptos-labs/zk-actions'],
        '0.0.2',
        'Registry zk-actions version must remain 0.0.2',
    );
    assert.equal(
        manifest.main,
        './dist/index.cjs.js',
        'Review runtime allowlist if main changes',
    );
    const staged = {};
    for (const key of [
        'name',
        'version',
        'description',
        'license',
        'private',
        'main',
        'exports',
        'engines',
        'dependencies',
        'optionalDependencies',
        'peerDependencies',
        'peerDependenciesMeta',
    ]) {
        if (own(manifest, key)) staged[key] = manifest[key];
    }
    staged.packageManager = 'pnpm@8.6.1';
    staged.files = ['dist/index.cjs.js'];
    const lock = YAML.parse(
        safeFile(path.join(repo, 'pnpm-lock.yaml')).toString(),
    );
    const pruned = prune(manifest, lock);
    const actionRef =
        pruned.importers['.'].dependencies['@aptos-labs/zk-actions'].version;
    assert(
        /^0\.0\.2(?:\(|$)/.test(actionRef),
        'Registry zk-actions snapshot changed',
    );
    return {
        'package.json': Buffer.from(json(staged)),
        'pnpm-lock.yaml': Buffer.from(YAML.stringify(pruned, { lineWidth: 0 })),
        'dist/index.cjs.js': safeFile(path.join(backend, 'dist/index.cjs.js')),
        '.env': config,
    };
}
function inventory(dir, prefix = '') {
    rejectParentSymlinks(dir);
    assert(!fs.lstatSync(dir).isSymbolicLink(), 'Stage symlink forbidden');
    const files = [];
    for (const name of fs.readdirSync(dir).sort()) {
        const relative = prefix + name;
        const absolute = path.join(dir, name);
        const stat = fs.lstatSync(absolute);
        assert(!stat.isSymbolicLink(), `Stage symlink forbidden: ${relative}`);
        if (stat.isDirectory()) {
            files.push(relative + '/');
            files.push(...inventory(absolute, relative + '/'));
        } else {
            assert(stat.isFile(), 'Non-regular stage entry');
            files.push(relative);
        }
    }
    return files;
}
export function verify(repo = root) {
    const files = expectedFiles(repo);
    const stage = path.join(repo, stageRelative);
    assert.deepEqual(
        inventory(stage),
        [...Object.keys(files), 'dist/'].sort(),
        'Stage contains missing/extra files (including secrets or node_modules)',
    );
    for (const [name, contents] of Object.entries(files)) {
        assert(
            safeFile(path.join(stage, name)).equals(contents),
            `Stale/tampered stage: ${name}`,
        );
    }
    const hashes = Object.fromEntries(
        Object.entries(files).map(([name, data]) => [
            name,
            crypto.createHash('sha256').update(data).digest('hex'),
        ]),
    );
    console.log(JSON.stringify({ verified: stageRelative, hashes }));
    return hashes;
}
export function createStage(repo = root) {
    // Validate all inputs before removing an old stage. Fixed path, no arbitrary output deletion.
    const files = expectedFiles(repo);
    const stage = path.join(repo, stageRelative);
    safeFile(path.join(repo, 'packages/backend/package.json'));
    rejectParentSymlinks(stage);
    const existing = fs.lstatSync(stage, { throwIfNoEntry: false });
    if (existing) {
        assert(existing.isDirectory(), 'Stage must be a directory');
        // Only the fixed allowlist may be replaced. Unknown files, empty directories,
        // symlinks and node_modules require explicit human review/removal.
        const allowed = new Set([...Object.keys(files), 'dist/']);
        for (const entry of inventory(stage)) {
            assert(
                allowed.has(entry),
                `Refusing to delete unknown stage entry: ${entry}`,
            );
        }
    }
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(path.join(stage, 'dist'), { recursive: true });
    for (const [name, data] of Object.entries(files))
        fs.writeFileSync(path.join(stage, name), data, { mode: 0o644 });
    return verify(repo);
}
if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    assert(
        process.argv.length === 3 &&
            ['stage', 'verify'].includes(process.argv[2]),
        'Usage: node scripts/packaging/stage.mjs stage|verify',
    );
    if (process.argv[2] === 'stage') createStage();
    else verify();
}
