import { defineConfig } from 'tsdown'

/**
 * Build the Electron main process and the sandboxed preload bridge from the
 * Host TypeScript emit.
 *
 * Two separate configurations keep the preload self-contained: a sandboxed
 * preload cannot `require` sibling files, and one shared build would split
 * the common lifecycle module into a chunk the preload then fails to load.
 * The main build emits `lib/main.js` (ESM, referenced by package `main`) plus
 * the inert `lib/main.cjs` twin; the preload build emits only
 * `lib/preload.cjs` (CommonJS — sandboxed preloads cannot load ESM), with the
 * lifecycle helpers inlined.
 */
const common = {
  outDir: 'lib',
  platform: 'node' as const,
  target: 'es2024',
  deps: { neverBundle: ['electron'] },
  outExtension: ({ format }: { format: 'esm' | 'cjs' }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  fixedExtension: false,
  dts: false,
  clean: false,
}

export default defineConfig([
  {
    ...common,
    entry: {
      main: 'lib/types/main.js',
    },
    format: ['esm', 'cjs'],
  },
  {
    ...common,
    entry: {
      preload: 'lib/types/preload.js',
    },
    format: ['cjs'],
  },
])
