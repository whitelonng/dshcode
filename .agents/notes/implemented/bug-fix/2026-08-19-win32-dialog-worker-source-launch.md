# Agent Note: Win32 dialog worker source launch drops the tsx bootstrap

Status: implemented

English | [中文](2026-08-19-win32-dialog-worker-source-launch.zh.md)

## Problem

On Windows, the source-plane folder dialog worker never started: the Web UI reported `win32 folder dialog worker exited before reporting a result`. The failure was in the launch vector, not koffi: the source arm used `node --import tsx/esm <absolute .ts path>`. With a loader registered through `--import`, a Windows absolute path can be interpreted as an `e:` scheme URL and rejected with `ERR_UNSUPPORTED_ESM_URL_SCHEME` before the worker posts its first IPC message.

The arm choice also read the raw `import.meta.url`. Vitest and Vite may decorate a module URL with a query string, and a decorated URL failed that `endsWith('.ts')` test, so a source-plane test could select the built arm. That is a bundler-specific test hazard, not a POSIX runtime cause of the Windows failure.

## Decision

Run the source worker directly under Node's native type stripping:

```ts
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

spawn(process.execPath, [fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], {
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
})
```

The repository requires `^22.19.0 || >=24.0.0`, and this worker dependency graph is package-local: the worker, bindings, and logic modules import no workspace packages, so no tsconfig `paths` projection is needed. The graph is erasable-only **with type-only relative imports**; `tsconfig.base.json` sets `verbatimModuleSyntax: false`, so TypeScript does not force a value-position type import into a type-only one, and such an import would fail under direct native stripping.

`packages/code-runtime/code-runtime-worker-thread/src/index.ts` already loads its source worker this way under the same two preconditions, and `docs/testing.md#test-subprocess-launch-modes` permits erasable `.ts` subprocesses to run directly with Node without tsx or the root paths map.

The packaged arm remains `worker.cjs` under plain node. Both arms choose from `new URL(import.meta.url).pathname.endsWith('.ts')`, so a query string on the module URL cannot misclassify a source module as built.

## Runtime inheritance

A source worker inherits `NODE_OPTIONS` from the host, and either spelling that disables native type stripping across the supported Node range is removed from the child environment:

- `--no-experimental-strip-types`
- `--no-strip-types`

Every other `NODE_OPTIONS` entry is preserved, and an options string that carried only disable flags leaves the variable unset in the child. Sanitization is scoped to the source arm: the packaged `worker.cjs` arm has no native type-stripping dependency, so its inherited options are passed through untouched.

The two preconditions are enforced by the real worker launch rather than by a static gate. A non-erasable construct such as a value `enum`, or a type-only import degraded to a value import, makes Node reject the entry before the worker reports, which surfaces as a worker-exit rejection instead of the expected Win32 dialog error.

## Related launch paths

The `dsh` CLI source launch keeps the tsx ESM hook because its graph needs a transform mode Node no longer ships, per [the source-launch decision](../architecture/2026-07-29-dsh-source-launch-tsx-esm.md); that constraint is about the CLI graph, not about native stripping being unavailable in the engines range.

`packages/workflow/workflow-worker-thread/src/host.ts` selects its own source/built arm from the raw `import.meta.url`, but it boots the worker from a `data:` URL carrying a proper `file://` href, so the Windows `e:`-scheme failure cannot reach that launch.

## Alternatives considered

**Pass the worker as a `file://` URL instead of a path.** Rejected: tsx's tsconfig-paths hook mangles `file://` URLs into `<cwd>\file:\<path>` (`ERR_MODULE_NOT_FOUND`); keeping any tsx involvement leaves a fragile launch.

**Probe koffi availability and fall back to pure-Node dialogs.** Out of scope: dshcode pins koffi 3.1.1, which predates the broken 3.1.3/3.1.4 win32-x64 prebuilds, so the worker's koffi usage is not the failure on this codebase; the worker itself crashed before koffi ever loaded.

**Pass an explicit enabling flag to the child instead of sanitizing `NODE_OPTIONS`.** Rejected: Node already renamed the negation of this feature once (`--no-experimental-strip-types`, then `--no-strip-types`), so a hardcoded enabling flag couples the launch to a Node line; removing both known disable spellings needs no such pin and leaves every unrelated host option intact.

## Consequences

- Windows source launches (`pnpm dsh web`) run the worker directly under Node's native type stripping, so the `e:` scheme failure of the loader chain is gone.
- Packaged hosts keep the unchanged CJS worker arm and an untouched `NODE_OPTIONS`.
- The source arm depends on the engines range, a package-local erasable-only graph, type-only relative imports, and removal of inherited type-stripping disable flags; `packages/host/directory-picker-native/README.md` records that for consumers.
- The Win32 smoke reaches the real source launch even where a module runner decorates URLs with query strings.

## Verification

- `packages/host/directory-picker-native/tests/win32-dialog-host.spec.ts` pins the source launch: `process.execPath` runs the worker path as the sole positional argument, with no loader flag.
- The same suite pins all three `NODE_OPTIONS` inputs: a mixed string keeps its unrelated entries, a string of only disable flags leaves the variable unset, and an unset variable stays unset without the parent being mutated.
- `tests/win32-dialog.spec.ts` launches the real source worker on POSIX, which is what catches a non-erasable construct or a lost type-only import in this graph.
- On win32 the same suite opens and abort-closes a real dialog through the source arm; `tests/built-worker.e2e.ts` owns the packaged `worker.cjs` arm this decision leaves unchanged.
