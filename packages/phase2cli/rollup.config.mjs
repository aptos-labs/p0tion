import typescript from "@rollup/plugin-typescript"
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
    input: "src/index.ts",
    output: {
        sourcemap: true,
        dir: "dist",
        format: "cjs"
    },
    plugins: [typescript(), nodeResolve()]
}
