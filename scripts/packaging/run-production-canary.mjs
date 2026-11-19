import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// This performs an authenticated read-only production check and reuses CLI login.
// Keep the npm install outside the workspace so npm cannot choose an unbuilt sibling.
const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'p0tion-canary-client-'));
fs.chmodSync(temporary, 0o700);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
try {
    for (const name of ['user.npmrc', 'global.npmrc']) {
        fs.writeFileSync(path.join(temporary, name), '', { mode: 0o600 });
    }
    const install = spawnSync('npm', ['install', '--prefix', temporary,
        '--cache', path.join(temporary, 'cache'), '--ignore-scripts', '--no-audit', '--no-fund',
        '--userconfig=' + path.join(temporary, 'user.npmrc'),
        '--globalconfig=' + path.join(temporary, 'global.npmrc'),
        '@aptos-labs/zk-ceremony@0.1.2'], { stdio: 'inherit' });
    if (install.error) throw install.error;
    if (install.status !== 0) throw new Error('Isolated client install failed');
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--check-signed-download')) {
        throw new Error('Only --check-signed-download is supported');
    }
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/packaging/check-production-canary.mjs'), ...args], {
        cwd: root, stdio: 'inherit', env: { ...process.env,
            P0TION_CLI_PACKAGE_ROOT: path.join(temporary, 'node_modules/@aptos-labs/zk-ceremony') }
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
