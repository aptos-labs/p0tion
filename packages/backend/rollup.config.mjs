import typescript from "@rollup/plugin-typescript"
import autoExternal from "rollup-plugin-auto-external"

export default {
    input: "src/index.ts",
    output:{
        sourcemap: true,
        file: "dist/index.cjs.js",
        format: "cjs"
    },
    plugins: [ autoExternal(), typescript()]
}

