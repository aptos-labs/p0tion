import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serializeConfig } from './config-policy.mjs';

export function verifyFallback(root) {
    const stage = path.join(root, 'packages/backend/.fallback-stage');
    const proof = JSON.parse(fs.readFileSync(path.join(root, '.packaging-evidence/code-fallback/provenance.json'), 'utf8'));
    const expected = ['.env', 'dist/index.cjs.js', 'package.json', 'pnpm-lock.yaml'].sort();
    if (JSON.stringify(Object.keys(proof.files).sort()) !== JSON.stringify(expected)) {
        throw new Error('Unexpected fallback proof inventory');
    }
    if (!fs.lstatSync(stage).isDirectory() || fs.realpathSync(stage) !== path.resolve(stage)) {
        throw new Error('Fallback stage must not contain parent symlinks');
    }
    const inventory = [];
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) throw new Error('Fallback symlink rejected');
            if (entry.isDirectory()) {
                if (path.relative(stage, full) !== 'dist') throw new Error('Unexpected fallback directory');
                visit(full);
            } else if (entry.isFile()) inventory.push(path.relative(stage, full));
            else throw new Error('Unsupported fallback file');
        }
    }
    visit(stage);
    if (JSON.stringify(inventory.sort()) !== JSON.stringify(expected)) throw new Error('Fallback inventory mismatch');
    for (const name of expected) {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(stage, name))).digest('hex');
        if (hash !== proof.files[name]) throw new Error(`Fallback hash mismatch: ${name}`);
    }
    const dotenv = fs.readFileSync(path.join(stage, '.env'), 'utf8');
    const config = Object.fromEntries(dotenv.trimEnd().split('\n').map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
    }));
    if (serializeConfig(config) !== dotenv) throw new Error('Fallback configuration is not canonical nonsecret data');
    const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
    if (manifest.engines?.node !== '22') throw new Error('Fallback must retain supported Node 22 runtime');
    return { kind: proof.kind, filesVerified: expected.length, restoresNode18: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    console.log(JSON.stringify(verifyFallback(root)));
}
