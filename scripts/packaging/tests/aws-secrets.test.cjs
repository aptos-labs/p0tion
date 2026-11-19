const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const ts = require(process.env.TYPESCRIPT_PATH || "typescript")
const root = path.resolve(__dirname, "../../../packages/backend/src")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8")
const parse = (file) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)

// Compile only the dependency-free helper: never import the app or Firebase.
const compiled = ts.transpileModule(read("lib/awsCredentials.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText
const helper = { exports: {} }
new Function("exports", "module", compiled)(helper.exports, helper)
const { createAWSCredentialsGetter } = helper.exports

test("credential resolution is deferred and refreshed on every invocation", () => {
    let calls = 0
    let access = "test-access-1"
    const get = createAWSCredentialsGetter(
        { value: () => { calls++; return access } },
        { value: () => { calls++; return "test-secret" } }
    )
    assert.equal(calls, 0)
    assert.deepEqual(get(), { accessKeyId: "test-access-1", secretAccessKey: "test-secret" })
    access = "test-access-2"
    assert.equal(get().accessKeyId, access)
    assert.equal(calls, 4)
})

for (const [access, secret] of [["", "test-secret"], ["test-access", ""], ["", ""]]) {
    test(`missing credentials fail safely (${Boolean(access)}, ${Boolean(secret)})`, () => {
        const get = createAWSCredentialsGetter({ value: () => access }, { value: () => secret })
        assert.throws(get, { message: "AWS credentials are unavailable" })
    })
}

test("reader errors cannot leak credential details", () => {
    for (const failingReader of [0, 1]) {
        const readers = [0, 1].map((index) => ({ value: () => {
            if (index === failingReader) throw new Error("test-sensitive-reader-details")
            return "test-sensitive-value"
        } }))
        assert.throws(createAWSCredentialsGetter(...readers), { message: "AWS credentials are unavailable" })
    }
})

const targets = {
    storage: ["createBucket", "checkIfObjectExist", "generateGetObjectPreSignedUrl", "startMultiPartUpload", "generatePreSignedUrlsParts", "completeMultiPartUpload"],
    ceremony: ["setupCeremony", "finalizeCeremony"],
    circuit: ["coordinateCeremonyParticipant", "verifycontribution", "finalizeCircuit"]
}
const properties = (node) => Object.fromEntries(node.properties.map((p) => [p.name.getText(), p.initializer.getText()]))

test("exactly the eleven specified handlers bind AWS_SECRETS and preserve options", () => {
    const bound = []
    for (const [file, names] of Object.entries(targets)) {
        const ast = parse(`functions/${file}.ts`)
        for (const statement of ast.statements) {
            if (!ts.isVariableStatement(statement)) continue
            for (const declaration of statement.declarationList.declarations) {
                const name = declaration.name.getText(ast)
                const options = []
                const visit = (node) => {
                    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
                        const method = node.expression.name.text
                        if (method === "runWith" || (method === "onCall" && name === "verifycontribution")) {
                            if (node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) options.push(node.arguments[0])
                        }
                    }
                    ts.forEachChild(node, visit)
                }
                if (declaration.initializer) visit(declaration.initializer)
                for (const option of options) {
                    const props = properties(option)
                    if (props.secrets) {
                        bound.push(name)
                        assert.ok(names.includes(name), `unexpected binding: ${name}`)
                        assert.equal(props.secrets, "AWS_SECRETS")
                        if (name === "verifycontribution") {
                            assert.deepEqual(props, { memory: '"32GiB"', timeoutSeconds: "3600", region: '"us-central1"', secrets: "AWS_SECRETS", serviceAccount: "AWS_RUNTIME_SERVICE_ACCOUNT" })
                            assert.match(declaration.initializer.getText(ast), /^functionsV2\.https\.onCall/)
                        } else {
                            assert.deepEqual(props, { secrets: "AWS_SECRETS", serviceAccount: "AWS_RUNTIME_SERVICE_ACCOUNT", memory: '"512MB"', ...(name === "generatePreSignedUrlsParts" ? { timeoutSeconds: "300" } : {}) })
                            assert.match(declaration.initializer.getText(ast), /\.runWith\(/)
                        }
                    }
                }
            }
        }
    }
    assert.deepEqual(bound.sort(), Object.values(targets).flat().sort())
})

test("declarations retain injection names and never eagerly resolve values", () => {
    const source = read("lib/secrets.ts")
    assert.match(source, /defineSecret\("AWS_ACCESS_KEY_ID"\)/)
    assert.match(source, /defineSecret\("AWS_SECRET_ACCESS_KEY"\)/)
    assert.match(source, /AWS_SECRETS = \[AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY\]/)
    assert.match(source, /getAWSCredentials = createAWSCredentialsGetter\(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY\)/)
    const ast = parse("lib/secrets.ts")
    const calls = []
    const visit = (node) => {
        if (ts.isCallExpression(node)) calls.push(node.expression.getText(ast))
        ts.forEachChild(node, visit)
    }
    visit(ast)
    assert.deepEqual(calls.sort(), ["createAWSCredentialsGetter", "getAWSRuntimeServiceAccount", "defineSecret", "defineSecret"].sort())
    assert.doesNotMatch(source, /GITHUB_ACCESS_TOKEN|defineString|defineInt/)
})

test("backend credential consumers use the lazy getter; nonsecret env and dotenv remain", () => {
    for (const file of ["lib/services.ts", "lib/utils.ts"]) {
        const source = read(file)
        assert.doesNotMatch(source, /process\.env\.AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)/)
        assert.match(source, /const credentials = getAWSCredentials\(\)/)
        assert.match(source, /process\.env\.AWS_REGION/)
    }
    assert.match(read("lib/utils.ts"), /dotenv\.config\(\)/)
    assert.match(read("lib/services.ts"), /process\.env\.AWS_PRESIGNED_URL_EXPIRATION/)
    assert.match(read("lib/utils.ts"), /process\.env\.AWS_INSTANCE_PROFILE_ARN/)
})
