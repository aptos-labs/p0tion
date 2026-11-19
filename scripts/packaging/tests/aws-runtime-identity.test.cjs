const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('../node_modules/typescript')
const source = fs.readFileSync(path.resolve(__dirname, '../../../packages/backend/src/lib/awsRuntimeIdentity.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const compiledExports = {}
vm.runInNewContext(compiled, { exports: compiledExports })
const getAccount = compiledExports.getAWSRuntimeServiceAccount

test('runtime identity follows deployment project rather than hardcoding dev', () => {
    assert.equal(getAccount('aptos-p0tion-dev'), 'p0tion-aws-functions@aptos-p0tion-dev.iam.gserviceaccount.com')
    assert.equal(getAccount('another-project'), 'p0tion-aws-functions@another-project.iam.gserviceaccount.com')
})

test('missing or malformed project never falls back to a shared identity', () => {
    for (const value of [undefined, '', 'bad/project', 'bad@identity', 'PROJECT', 'abc']) {
        assert.throws(() => getAccount(value))
    }
})
