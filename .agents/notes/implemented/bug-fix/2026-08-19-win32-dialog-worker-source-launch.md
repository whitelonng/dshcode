# Agent Note: Win32 dialog worker source launch drops the tsx bootstrap

Status: implemented

English | [中文](2026-08-19-win32-dialog-worker-source-launch.zh.md)

## Problem

On Windows, the source-plane folder dialog worker never started: the Web UI reported
`win32 folder dialog worker exited before reporting a result`. The failure was in the
launch vector, not koffi: the source arm used `node --import tsx/esm <absolute .ts path>`.
With a loader registered through `--import`, a Windows absolute path can be interpreted
as an `e:` scheme URL and rejected with `ERR_UNSUPPORTED_ESM_URL_SCHEME` before the worker
posts its first IPC message.

CI also had a test-selection blind spot: Vitest/Vite may append a query string to
`import.meta.url`, so a raw `import.meta.url.endsWith('.ts')` check can select the built
arm during source-plane tests. This is a bundler-specific test hazard, not a POSIX runtime
root cause.

## Decision

Run the source worker directly under Node's native type stripping:

```ts
spawn(process.execPath, [fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], ...)
```

The repository requires `^22.19.0 || >=24.0.0`, and this worker dependency graph is
package-local: the worker, bindings, and logic modules import no workspace packages.
The graph is erasable-only **with type-only relative imports**; `tsconfig.base.json`
uses `verbatimModuleSyntax: false`, so value-position type imports are not automatically
rewritten into type-only imports and would be unsafe for direct native stripping.

This is backed by existing repository precedent rather than a novel launch mode:
`packages/code-runtime/code-runtime-worker-thread/src/index.ts` already loads its
source worker directly under native type stripping and requires an erasable-only graph
with type-only relative imports. `docs/testing.md#test-subprocess-launch-modes` also
explicitly permits erasable `.ts` subprocesses to run directly with Node without tsx or
the root paths map.

The packaged arm remains `worker.cjs` under plain node. The source/built arm now uses
`new URL(import.meta.url).pathname.endsWith('.ts')` so bundler query strings cannot
misclassify source modules as built.

## Runtime inheritance

A source worker can inherit `NODE_OPTIONS` from the host. Both spellings used across
the supported Node range that disable native type stripping are removed from the child
environment:

- `--no-experimental-strip-types`
- `--no-strip-types`

Other `NODE_OPTIONS` entries are preserved. Sanitization is deliberately scoped to the
source arm because the packaged `worker.cjs` arm has no native type-stripping dependency
and should not have its inherited options rewritten for an unrelated reason.

The source graph's erasability is also guarded by the real worker launch: introducing a
non-erasable construct such as a value `enum` or losing a type-only import causes native
Node execution to fail before the expected Win32 dialog error, so POSIX CI catches syntax
or import drift in this graph.

## Related launch paths

The CLI source graph still uses tsx because it has a broader runtime dependency graph;
that is an intentional separate case. The packaged dialog worker is already CJS and does
not need the source-plane treatment.

`packages/workflow/workflow-worker-thread/src/host.ts:69` also has source/built arm
detection, but its worker boots from a `data:` URL with a proper `file://` href, so it
does not expose the Windows `e:`-scheme failure addressed here. It remains unchanged;
the shared lesson is to use URL pathname when bundler query strings can decorate the URL.

## Alternatives considered

**Pass the worker as a `file://` URL instead of a path.** Rejected: tsx's tsconfig-paths
hook mangles `file://` URLs into `<cwd>\\file:\\<path>` (`ERR_MODULE_NOT_FOUND`); keeping
any tsx involvement leaves a fragile launch.

**Probe koffi availability and fall back to pure-Node dialogs.** Out of scope:
dshcode pins koffi 3.1.1, which predates the broken 3.1.3/3.1.4 win32-x64 prebuilds, so
the worker's koffi usage is not the failure on this codebase; the worker itself crashed
before koffi ever loaded.

## Consequences

- Windows source launches (`pnpm dsh web`) run the worker directly under Node's native
  type stripping, removing the `e:` scheme failure caused by the previous loader chain.
- Packaged hosts continue launching the unchanged CJS worker arm, without rewriting
  their `NODE_OPTIONS`.
- The source arm remains dependent on the repository Node engines range, an erasable-only
  package-local graph, type-only relative imports, and removal of inherited type-stripping
  disable flags.
- The Win32 source smoke test now reaches the actual source launch even when Vitest/Vite
  decorates module URLs with query strings.

## Verification

- Package Vitest: **50 passed, 1 skipped** after the coverage regression case is added.
- Coverage gate: the sanitizer's `undefined` branch is explicitly exercised so the
  per-file 100% branch threshold is retained.
- Typecheck: passed.
- Lint: passed with 0 warnings and 0 errors.
- `verify-translation-pairing`: passed with the bilingual sidecar record.
- `verify-agent-note-classification`: passed.
- `verify-agent-note-format`: required `Alternatives considered` and `Consequences` are
  restored.
- The existing real Win32 smoke continues to exercise the source-plane dialog launch.
