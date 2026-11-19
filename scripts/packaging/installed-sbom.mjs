// Flat installed-package inventory only: no npm graph inference or application imports.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { rejectParentSymlinks } from './stage.mjs';

const sha256 = (bytes) =>
    crypto.createHash('sha256').update(bytes).digest('hex');
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const property = (name, value) => ({
    name: `p0tion:${name}`,
    value: String(value),
});
export const assessment =
    'Flat installed package.json inventory; dependency graph and reachability not assessed. Lifecycle scripts not run; platform-specific optional packages may be absent.';

export function npmPurl(name, version) {
    assert(
        typeof name === 'string' && /^(?:@[^/\s]+\/)?[^/\s]+$/.test(name),
        'Invalid installed package name',
    );
    assert(
        typeof version === 'string' && version.length > 0,
        'Missing installed package version',
    );
    return `pkg:npm/${name.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(version)}`;
}

export function installedInventory(project) {
    rejectParentSymlinks(project);
    const boundary = path.join(fs.realpathSync(project), 'node_modules');
    rejectParentSymlinks(boundary);
    assert(
        fs.statSync(boundary).isDirectory(),
        'Missing installed node_modules',
    );
    const seenDirectories = new Set();
    const packages = new Map();
    function inside(filename) {
        const target = fs.realpathSync(filename);
        const relative = path.relative(boundary, target);
        assert(
            relative === '' ||
                (!relative.startsWith(`..${path.sep}`) &&
                    relative !== '..' &&
                    !path.isAbsolute(relative)),
            `Installed symlink escapes install boundary: ${filename}`,
        );
        return target;
    }
    function walk(directory) {
        const real = inside(directory);
        assert(
            fs.statSync(real).isDirectory(),
            `Not an installed directory: ${directory}`,
        );
        const parent = path.dirname(directory);
        const isPackage =
            path.basename(parent) === 'node_modules' ||
            (path.basename(parent).startsWith('@') &&
                path.basename(path.dirname(parent)) === 'node_modules');
        const manifestPath = path.join(real, 'package.json');
        if (isPackage && fs.existsSync(manifestPath)) {
            assert(
                !fs.lstatSync(manifestPath).isSymbolicLink(),
                'Installed package.json symlink forbidden',
            );
            assert(
                fs.statSync(manifestPath).isFile(),
                'Installed manifest must be a regular file',
            );
            const bytes = fs.readFileSync(manifestPath);
            const manifest = JSON.parse(bytes);
            const relative = path
                .relative(boundary, real)
                .split(path.sep)
                .join('/');
            packages.set(real, {
                type: 'library',
                'bom-ref': `installed:${encodeURIComponent(relative)}`,
                name: manifest.name,
                version: manifest.version,
                purl: npmPurl(manifest.name, manifest.version),
                properties: [
                    property('installed-path', `node_modules/${relative}`),
                    property('package-json-sha256', sha256(bytes)),
                ],
            });
        }
        if (seenDirectories.has(real)) return;
        seenDirectories.add(real);
        for (const name of fs.readdirSync(real).sort(order)) {
            const entry = path.join(real, name);
            const stat = fs.lstatSync(entry);
            // Ignore .bin links (executables, not installed package manifests).
            if (name === '.bin') continue;
            if (stat.isDirectory() || stat.isSymbolicLink()) {
                const target = inside(entry);
                if (fs.statSync(target).isDirectory()) walk(entry);
                else
                    assert(
                        name !== 'package.json',
                        'Installed package.json symlink forbidden',
                    );
            }
        }
    }
    walk(boundary);
    return [...packages.values()].sort((a, b) =>
        order(a['bom-ref'], b['bom-ref']),
    );
}

export function generateSbom(project, stageHashes = {}) {
    const manifestBytes = fs.readFileSync(path.join(project, 'package.json'));
    const manifest = JSON.parse(manifestBytes);
    const components = installedInventory(project);
    assert(components.length > 0, 'Empty installed SBOM');
    return {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        version: 1,
        metadata: {
            component: {
                type: 'application',
                'bom-ref': 'staged-application',
                name: manifest.name,
                version: manifest.version,
                purl: npmPurl(manifest.name, manifest.version),
            },
            properties: [
                property('assessment', assessment),
                property('installed-package-count', components.length),
                property('package-json-sha256', sha256(manifestBytes)),
                ...Object.keys(stageHashes)
                    .sort(order)
                    .map((name) =>
                        property(`stage-sha256:${name}`, stageHashes[name]),
                    ),
            ],
        },
        components,
    };
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    assert(
        process.argv.length === 4,
        'Usage: node scripts/packaging/installed-sbom.mjs /installed/project /output.json',
    );
    const bom = generateSbom(path.resolve(process.argv[2]));
    fs.writeFileSync(process.argv[3], JSON.stringify(bom, null, 4) + '\n', {
        flag: 'wx',
    });
    console.log(
        JSON.stringify({
            installedPackages: bom.components.length,
            assessment,
        }),
    );
}
