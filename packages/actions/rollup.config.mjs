import typescript from "@rollup/plugin-typescript"

export default {
    input: "src/index.ts",
    output: [{
        sourcemap: true,
        file: "dist/index.esm.js",
        format: "esm"
    }, {
        sourcemap: true,
        file: "dist/index.cjs.js",
        format: "cjs"
    }],
    plugins: [typescript()]
}
