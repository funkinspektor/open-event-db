// Production build: bundles the server (and the migration runner) into self-contained ESM files.
// The workspace packages @open-event-db/shared and /db export raw TypeScript, which plain `tsc` output
// can't import at runtime — esbuild compiles them in, together with all npm dependencies, so the
// container needs nothing but `node dist/index.js`.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts', 'src/migrate.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
  // Some bundled CommonJS dependencies call require() for Node built-ins.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})
