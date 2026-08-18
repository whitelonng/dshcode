# Agent Note: Win32 dialog worker source launch drops the tsx bootstrap

Status: implemented

English | [中文](2026-08-19-win32-dialog-worker-source-launch.zh.md)

## Problem

On Windows, the source-plane folder dialog worker never started: the Web UI
reported `win32 folder dialog worker exited before reporting a result`. The
root cause is the launch vector, not koffi: `spawnDialogWorker`'s source arm
ran `node --import tsx/esm <absolute .ts path>`. With a loader registered via
`--import`, Node's ESM loader resolves the entry as a URL, and a Windows
absolute path (`E:\...`) becomes an `e:` scheme URL, throwing
`ERR_UNSUPPORTED_ESM_URL_SCHEME` before the worker's first IPC message. The
driver then surfaces only its generic exit error. Packaged consumers were
unaffected because they launch the built `worker.cjs` under plain node; the
bug hit every source launch (`pnpm dsh web`) on Windows.

CI missed it for a second, compounding reason: the built/source arm choice
tested `import.meta.url.endsWith('.ts')`, and under Vitest/Vite the URL carries
a query string (`?v=...`), so the win32 smoke test silently exercised the built
arm — never the broken source launch.

## Decision

Run the source worker under plain node with native type stripping, no tsx
bootstrap:

```ts
spawn(process.execPath, [fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], ...)
```

This is safe because the worker's dependency chain (worker, bindings, logic)
uses only erasable TypeScript syntax — no parameter properties, decorators, or
value namespaces — unlike the CLI source graph that keeps the tsx ESM hook.
Native type stripping is stable since Node 22.18, inside the engines range
(`^22.19.0 || >=24.0.0`). The built arm (`worker.cjs` under plain node) is
unchanged.

The arm choice now reads `new URL(import.meta.url).pathname.endsWith('.ts')` so
bundler query strings cannot misclassify source modules as built. This makes
the win32 smoke test exercise the real source launch, and the new
`win32-dialog-host.spec.ts` case pins that the source arm passes the worker
path positionally with no `--import` flag.

## Alternatives considered

**Pass the worker as a `file://` URL instead of a path.** Rejected: tsx's
tsconfig-paths hook mangles `file://` URLs into `<cwd>\file:\<path>`
(`ERR_MODULE_NOT_FOUND`); keeping any tsx involvement leaves a fragile launch.

**Probe koffi availability and fall back to pure-Node dialogs.** Out of scope:
dshcode pins koffi 3.1.1, which predates the broken 3.1.3/3.1.4 win32-x64
prebuilds, so the worker's koffi usage is not the failure on this codebase; the
worker itself crashed before koffi ever loaded.

## Consequences

- Windows source launches (`pnpm dsh web`) open the folder dialog again; the
  failure mode (`e:` scheme URL) is gone with the loader chain.
- No functional change for packaged hosts or POSIX: they already ran the worker
  under plain node.
- The win32 smoke test now covers the source arm end to end; a regression to a
  loader-bootstrapped launch is caught by both the spawn-args pin and the real
  dialog smoke.

## Verification

`packages/host/directory-picker-native/tests/win32-dialog.spec.ts` opens and
abort-closes a real dialog through the source launch. The new
`win32-dialog-host.spec.ts` case asserts the positional worker path with no
`--import`. Full package suite: 48 passed, 1 skipped (the win32-skipped
built-worker e2e).
