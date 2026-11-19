// Local only: no application imports, no build or package lifecycle scripts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateSbom, assessment } from './installed-sbom.mjs';
import { verify, root, stageRelative, rejectParentSymlinks } from './stage.mjs';
const tools = path.dirname(fileURLToPath(import.meta.url));
assert(
    process.argv.length === 3,
    'Usage: node scripts/packaging/validate-install.mjs /absolute/evidence-directory',
);
const evidence = path.resolve(process.argv[2]);
assert(!fs.existsSync(evidence), 'Evidence directory must be new');
const hashes = verify();
rejectParentSymlinks(evidence);
fs.mkdirSync(evidence, { recursive: true });
// Outside the monorepo: pnpm must not discover its workspace configuration.
const temp = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'p0tion-install-'),
);
const project = path.join(temp, 'project');
fs.cpSync(path.join(root, stageRelative), project, {
    recursive: true,
    dereference: false,
});
fs.mkdirSync(path.join(temp, 'home'));
const env = {
    PATH: process.env.PATH,
    HOME: path.join(temp, 'home'),
    TMPDIR: temp,
    CI: 'true',
    npm_config_ignore_scripts: 'true',
    npm_config_userconfig: path.join(temp, 'empty.npmrc'),
    npm_config_globalconfig: path.join(temp, 'empty-global.npmrc'),
};
fs.writeFileSync(env.npm_config_userconfig, '');
fs.writeFileSync(env.npm_config_globalconfig, '');
function run(label, bin, args) {
    const result = spawnSync(bin, args, {
        cwd: project,
        env,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    });
    fs.writeFileSync(
        path.join(evidence, `${label}.log`),
        JSON.stringify({
            command: [bin, ...args],
            status: result.status,
            error: result.error?.message,
        }) +
            '\n' +
            (result.stdout || '') +
            (result.stderr || ''),
    );
    assert.equal(result.status, 0, `${label} failed; see evidence log`);
}
try {
    const pnpm = path.join(tools, 'node_modules/.bin/pnpm');
    run('install', pnpm, [
        'install',
        '--prod',
        '--frozen-lockfile',
        '--ignore-scripts',
        '--node-linker=hoisted',
        '--store-dir',
        path.join(temp, 'store'),
        '--registry=https://registry.npmjs.org',
    ]);
    // Hoisted install is disposable validation only. No lock regeneration.
    assert(
        fs
            .readFileSync(path.join(project, 'pnpm-lock.yaml'))
            .equals(
                fs.readFileSync(
                    path.join(root, stageRelative, 'pnpm-lock.yaml'),
                ),
            ),
        'Install changed lock',
    );
    const actions = JSON.parse(
        fs.readFileSync(
            path.join(
                project,
                'node_modules/@aptos-labs/zk-actions/package.json',
            ),
        ),
    );
    assert.equal(actions.version, '0.0.2');
    const bom = generateSbom(project, hashes);
    fs.writeFileSync(
        path.join(evidence, 'installed.cdx.json'),
        JSON.stringify(bom, null, 4) + '\n',
    );
    fs.writeFileSync(
        path.join(evidence, 'sbom.log'),
        JSON.stringify({
            status: 0,
            installedPackages: bom.components.length,
            assessment,
        }) + '\n',
    );
    assert.equal(bom.bomFormat, 'CycloneDX');
    assert(bom.components?.length > 0, 'Empty installed SBOM');
    fs.writeFileSync(
        path.join(evidence, 'result.json'),
        JSON.stringify(
            {
                install: 'passed',
                assessment,
                stageHashes: hashes,
                installedActions: actions.version,
                sbomComponents: bom.components.length,
                node: process.version,
                pnpm: '8.6.1',
                platform: process.platform,
                arch: process.arch,
            },
            null,
            2,
        ),
    );
} finally {
    fs.rmSync(temp, { recursive: true, force: true });
}
