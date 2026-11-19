import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verify as verifyStage } from './stage.mjs';
import { verifyFallback } from './verify-fallback.mjs';

export const PROJECT = 'aptos-p0tion-dev';
export const CLI_VERSION = '15.34.1';
export const FUNCTIONS = [
    'checkIfObjectExist', 'completeMultiPartUpload', 'coordinateCeremonyParticipant',
    'createBucket', 'finalizeCeremony', 'finalizeCircuit',
    'generateGetObjectPreSignedUrl', 'generatePreSignedUrlsParts',
    'setupCeremony', 'startMultiPartUpload', 'verifycontribution'
];

export const deployArgs = [
    'deploy', '--config', 'firebase.deploy.json', '--project', PROJECT,
    '--only', FUNCTIONS.map(name => `functions:${name}`).join(',')
];

export function assertReleaseAllowed(root) {
    const marker = path.join(root, '.packaging-evidence/callable-pause-active.json');
    if (fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, 'utf8')).active) {
        throw new Error('Production callables are owner-paused; release or fallback requires a reviewed pause/restoration plan');
    }
}

export function main(args) {
    if (args.length > 1 || (args.length === 1 && !['--plan', '--execute', '--plan-fallback', '--execute-fallback'].includes(args[0]))) {
        throw new Error('Usage: release-production.mjs [--plan|--execute|--plan-fallback|--execute-fallback]');
    }
    const fallback = args[0]?.endsWith('-fallback') ?? false;
    const selectedArgs = [...deployArgs];
    if (fallback) selectedArgs[selectedArgs.indexOf('--config') + 1] = 'firebase.fallback.json';
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const cli = path.join(root, 'scripts/packaging/node_modules/firebase-tools');
    const installed = JSON.parse(fs.readFileSync(path.join(cli, 'package.json'), 'utf8'));
    if (installed.version !== CLI_VERSION) throw new Error('Unexpected Firebase CLI version');
    if (!['--execute', '--execute-fallback'].includes(args[0])) {
        // This is our own plan, NOT Firebase --dry-run (which may mutate cloud state).
        console.log(JSON.stringify({ production: true, project: PROJECT,
            cliVersion: CLI_VERSION, functions: FUNCTIONS, arguments: selectedArgs,
            fallback, restoresNode18: false, executed: false }, null, 2));
        return;
    }
    // A release must not accidentally reopen owner-paused public callables.
    assertReleaseAllowed(root);
    // Execution requires separately approved production IAM/configuration/release gates.
    if (fallback) verifyFallback(root);
    else verifyStage(root);
    const result = spawnSync(process.execPath, [path.join(cli, 'lib/bin/firebase.js'), ...selectedArgs], {
        cwd: path.join(root, 'packages/backend'), stdio: 'inherit'
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2));
}
