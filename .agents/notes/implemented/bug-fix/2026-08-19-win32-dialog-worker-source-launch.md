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

## Decision

Run the source worker directly under Node's native type stripping:

```ts
spawn(process.execPath, [fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], ...)
```

The repository requires `^22.19.0 || >=24.0.0`, and this worker dependency graph is
package-local: the worker, bindings, and logic modules import no workspace packages.
The graph uses only erasable TypeScript syntax, so no tsx hook is required for this
source-plane worker. The packaged arm remains `worker.cjs` under plain node.

The source/built arm now uses `new URL(import.meta.url).pathname.endsWith('.ts')`.
The query-string issue is therefore treated as a bundler-specific test hazard, not as
a POSIX runtime root cause: Vitest/Vite can decorate module URLs, while ordinary POSIX
Node execution does not reproduce that decoration.

## Runtime inheritance

A source worker can inherit `NODE_OPTIONS` from the host. Both spellings used across
the supported Node range that disable native type stripping are removed from the child
environment:

- `--no-experimental-strip-types`
- `--no-strip-types`

Other `NODE_OPTIONS` entries are preserved. This prevents a host-level setting from
turning the fixed Windows launch back into the same generic worker-exit symptom.

## Related launch paths

The CLI source graph still uses tsx because it has a broader runtime dependency graph;
that is an intentional separate case. The packaged dialog worker is already CJS and does
not need the source-plane treatment. No other directory-picker worker uses this
Windows-absolute-path-plus-`--import` launch vector.

## Verification

- The spawn unit test pins the source worker path as a positional argument and rejects
  loader flags.
- The spawn unit test verifies both type-stripping-disabling `NODE_OPTIONS` spellings
  are removed while unrelated options are preserved.
- The existing Win32 smoke test continues to cover the real source-plane dialog.
