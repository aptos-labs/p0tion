const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['./src/index.ts'],
  bundle: true,
  platform: 'node',
  target: "node18",
  outfile: './dist/app-bundle.cjs',
  inject: ["./import-meta-url.js"],
  define: {"import.meta.url":"import_meta_url"}
}).catch((e) => console.error(e));
