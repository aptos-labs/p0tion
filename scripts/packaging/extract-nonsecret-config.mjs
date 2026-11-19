import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_KEYS, serializeConfig } from './config-policy.mjs';
import { FUNCTIONS } from './release-production.mjs';

export function extractNonsecretConfig(inputDirectory, outputDirectory) {
    const input = fs.realpathSync(inputDirectory);
    const output = path.resolve(outputDirectory);
    if (output === input || fs.existsSync(output)) {
        throw new Error('Output must be a new directory, separate from the raw exports');
    }
    // Parse only within this local process; never log the raw environment or values.
    const configs = new Map();
    for (const name of FUNCTIONS) {
        const source = path.join(input, `${name}.json`);
        if (!fs.lstatSync(source).isFile()) throw new Error(`Not a regular file: ${name}`);
        const raw = JSON.parse(fs.readFileSync(source, 'utf8'));
        if (!raw || Array.isArray(raw) || typeof raw !== 'object') {
            throw new Error(`Invalid export structure: ${name}`);
        }
        const clean = Object.fromEntries(CONFIG_KEYS
            .filter(key => Object.hasOwn(raw, key)).map(key => [key, raw[key]]));
        // Validate completeness before writing any sanitized file.
        serializeConfig(clean);
        configs.set(name, clean);
    }
    fs.mkdirSync(output, { mode: 0o700 });
    const baseline = configs.get('setupCeremony');
    const differences = [];
    for (const [name, config] of configs) {
        fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(config, null, 2) + '\n',
            { flag: 'wx', mode: 0o600 });
        const keys = CONFIG_KEYS.filter(key => config[key] !== baseline[key]);
        if (keys.length) differences.push({ function: name, differingKeys: keys });
    }
    const report = { functions: configs.size, keysPerFunction: CONFIG_KEYS.length,
        baseline: 'setupCeremony', allConsistent: differences.length === 0, differences,
        credentialValuesPrinted: false, originalsModified: false };
    fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 });
    return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length !== 4) {
        throw new Error('Usage: extract-nonsecret-config.mjs RAW_DIRECTORY NEW_OUTPUT_DIRECTORY');
    }
    console.log(JSON.stringify(extractNonsecretConfig(process.argv[2], process.argv[3]), null, 2));
}
