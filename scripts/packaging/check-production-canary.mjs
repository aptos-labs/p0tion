import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

// npm exec may resolve the local workspace instead of installing the registry package.
// An isolated runner supplies its exact package root. Never import the CLI entrypoint.
const binary = (process.env.PATH || '').split(path.delimiter)
    .map(directory => path.join(directory, 'zk-ceremony')).find(file => fs.existsSync(file));
const packageRoot = process.env.P0TION_CLI_PACKAGE_ROOT
    ? fs.realpathSync(process.env.P0TION_CLI_PACKAGE_ROOT)
    : binary ? path.resolve(path.dirname(fs.realpathSync(binary)), '..') : undefined;
if (!packageRoot) throw new Error('Use the isolated canary runner; npm exec selected an unbuilt workspace package');
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
if (manifest.name !== '@aptos-labs/zk-ceremony' || manifest.version !== '0.1.2') {
    throw new Error('Unexpected CLI package; refusing to read its authentication store');
}
const require = createRequire(path.join(packageRoot, 'package.json'));
const { parse } = require('dotenv');
const publicEnvironment = parse(fs.readFileSync(path.join(packageRoot, '.env')));
const project = publicEnvironment.FIREBASE_PROJECT_ID;
if (project !== 'aptos-p0tion-dev') throw new Error('CLI targets a different Firebase project; no authentication attempted');
const firebaseConfig = {
    projectId: project, apiKey: publicEnvironment.FIREBASE_API_KEY,
    authDomain: publicEnvironment.FIREBASE_AUTH_DOMAIN,
    appId: publicEnvironment.FIREBASE_APP_ID
};
if (!firebaseConfig.apiKey || !firebaseConfig.authDomain) throw new Error('Missing public Firebase client configuration');
const { default: Conf } = await import(pathToFileURL(require.resolve('conf')).href);
const store = new Conf({ projectName: manifest.name });
const token = store.get('accessToken');
if (typeof token !== 'string' || !token) throw new Error('No saved CLI login; run zk-ceremony auth first');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, GithubAuthProvider, signInWithCredential, getIdTokenResult, signOut } = require('firebase/auth');
const { getFirestore, collection, query, limit, getDocs, terminate } = require('firebase/firestore');
const { getFunctions, httpsCallable } = require('firebase/functions');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localConfig = JSON.parse(fs.readFileSync(path.join(root, 'packages/backend/deployment.config.json'), 'utf8'));
const app = initializeApp(firebaseConfig, 'p0tion-production-canary');
const auth = getAuth(app);
const db = getFirestore(app);
try {
    const signedIn = await signInWithCredential(auth, GithubAuthProvider.credential(token));
    const identity = await getIdTokenResult(signedIn.user, true);
    if (identity.claims.coordinator !== true) {
        throw new Error('Login has no coordinator claim; stopped without calling the function or changing permissions');
    }
    console.log('Production project and coordinator claim confirmed.');
    const ceremonies = await getDocs(query(collection(db, 'ceremonies'), limit(5)));
    let candidate;
    for (const ceremony of ceremonies.docs) {
        const prefix = ceremony.data().prefix;
        if (typeof prefix !== 'string' || !prefix) continue;
        const circuits = await getDocs(query(collection(db, 'ceremonies', ceremony.id, 'circuits'), limit(1)));
        const circuit = circuits.docs[0]?.data();
        const key = circuit?.files?.initialZkeyStoragePath || circuit?.files?.r1csStoragePath;
        if (typeof key === 'string' && key) {
            candidate = { bucketName: prefix + localConfig.AWS_CEREMONY_BUCKET_POSTFIX, objectKey: key };
            break;
        }
    }
    if (!candidate) throw new Error('No existing artifact candidate found; do not infer AWS health from a missing object');
    const result = await httpsCallable(getFunctions(app, 'us-central1'), 'checkIfObjectExist')(candidate);
    if (result.data !== true) throw new Error('Existing-object check was not true; AWS health is not confirmed');
    console.log('PASS: coordinator-authenticated production checkIfObjectExist found an existing S3 object. No object or document was changed.');
    if (process.argv.includes('--check-signed-download')) {
        const signed = await httpsCallable(getFunctions(app, 'us-central1'), 'generateGetObjectPreSignedUrl')(candidate);
        if (typeof signed.data !== 'string') throw new Error('Signed download check failed');
        const url = new URL(signed.data);
        if (url.protocol !== 'https:' || url.username || url.password || url.port ||
            !/(^|\.)s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname)) {
            throw new Error('Signed download check failed');
        }
        // The capability URL stays in memory and is never printed or written.
        const response = await fetch(url, { headers: { Range: 'bytes=0-0' }, redirect: 'error',
            signal: AbortSignal.timeout(30000) });
        await response.body?.cancel();
        if (response.status !== 206) throw new Error('Signed download check failed');
        console.log('PASS: production generateGetObjectPreSignedUrl and an S3 one-byte range GET succeeded. URL and content withheld.');
    }
} catch (error) {
    // Never serialize SDK errors: they may contain request credentials.
    const safeCodes = new Set(['auth/invalid-credential', 'auth/user-disabled', 'auth/account-exists-with-different-credential',
        'functions/permission-denied', 'functions/unauthenticated', 'functions/internal', 'permission-denied']);
    if (safeCodes.has(error?.code)) console.error(`Check failed: ${error.code}; tokens and SDK details withheld.`);
    else if (error?.message?.startsWith('Login has no coordinator') || error?.message?.startsWith('No existing artifact') || error?.message?.startsWith('Existing-object check')) console.error(error.message);
    else console.error('Check failed; SDK details withheld to protect authentication data.');
    process.exitCode = 1;
} finally {
    await signOut(auth).catch(() => {});
    await terminate(db).catch(() => {});
    await deleteApp(app).catch(() => {});
}
