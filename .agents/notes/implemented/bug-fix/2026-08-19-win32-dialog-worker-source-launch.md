# Agent Note: Win32 dialog worker source launch drops the tsx bootstrap

Status: implemented

English | [中文](2026-08-19-win32-dialog-worker-source-launch.zh.md)

## Problem

On Windows, the source-plane folder dialog worker never started: the Web UI reported `win32 folder dialog worker exited before reporting a result`. The failure was in the launch vector, not koffi: the source arm ran `node --import tsx/esm <absolute .ts path>`. With a loader registered through `--import`, an absolute path such as `E:\dsh\packages\host\directory-picker-native\src\win32-dialog-worker.ts` can be read as an `e:` scheme URL and rejected with `ERR_UNSUPPORTED_ESM_URL_SCHEME`, before the worker posts its first IPC message.

A raw `import.meta.url.endsWith('.ts')` check also decided which arm to launch. Vitest and Vite may decorate a module URL with a query string, and a decorated URL fails that suffix test, so a source-plane test could exercise the built arm — a bundler-specific test hazard rather than a cause of the Windows failure.

## Decision

Run the source worker directly under Node's native type stripping:

```ts
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

declare const env: NodeJS.ProcessEnv
spawn(process.execPath, [fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], { env, windowsHide: true })
```

The repository requires `^22.19.0 || >=24.0.0`, and this worker dependency graph is package-local: the worker, bindings, and logic modules import no workspace packages, so no tsconfig `paths` projection is needed.

Every relative import that names a type is marked, with `import type` or the inline `type` modifier. `tsconfig.base.json` sets `verbatimModuleSyntax: false`, so an unmarked type import is elided at build time and passes both `typecheck` and the bundle, while Node strip mode keeps the specifier and fails at load with `does not provide an export named`. Marking is mandatory here even though no compiler or lint rule demands it.

`packages/code-runtime/code-runtime-worker-thread/src/index.ts` already loads its source worker this way under the same two preconditions, and [the test-subprocess launch modes](../../../../docs/testing.md#test-subprocess-launch-modes) permit erasable `.ts` subprocesses to run directly with Node without tsx or the root paths map.

The packaged arm remains `worker.cjs` under plain node. Both arms choose from `new URL(import.meta.url).pathname.endsWith('.ts')`, so a query string on the module URL cannot misclassify a source module as built.

Neither precondition has a static gate; the real worker launch enforces both. A value `enum`, or a type import left unmarked, makes Node reject the entry before the worker posts, which surfaces as the worker-exit rejection instead of the expected Win32 dialog error.

## Inherited NODE_OPTIONS

A source worker inherits `NODE_OPTIONS` from the host, and either spelling that disables native type stripping across the supported Node range is removed from the child environment:

- `--no-experimental-strip-types`
- `--no-strip-types`

Every other entry is preserved, and an options string that carried only disable flags leaves the variable unset in the child. Sanitization is scoped to the source arm: the packaged `worker.cjs` arm has no native type-stripping dependency, so its inherited options pass through untouched.

An inherited `--import` is preserved like any other entry, so a host that registers a loader process-wide puts the `e:` scheme hazard back in front of the worker path. This launch cannot tell an instrumentation hook from a TypeScript one, so that case stays the host's to avoid.

## Related launch paths

The `dsh` CLI source launch keeps the tsx ESM hook because its graph needs a transform mode Node no longer ships, per [the source-launch decision](../architecture/2026-07-29-dsh-source-launch-tsx-esm.md); that constraint is about the CLI graph, not about native stripping being unavailable in the engines range.

`packages/sandbox/sandbox-local/src/index.ts` still builds this vector for the windows-acl runner's source arm, and that graph is package-local and erasable too, so the same launch applies there. It is a separate change: it also rewrites the assertion in `packages/sandbox/sandbox-local/tests/local.spec.ts` that pins the `--import tsx/esm` prefix.

`packages/workflow/workflow-worker-thread/src/host.ts` selects its own source/built arm from the raw `import.meta.url`, but it boots the worker from a `data:` URL carrying a proper `file://` href, so the `e:` scheme failure cannot reach that launch.

## Alternatives considered

**Pass the worker as a `file://` URL instead of a path.** Rejected: tsx's tsconfig-paths hook mangles `file://` URLs into `<cwd>\file:\<path>` (`ERR_MODULE_NOT_FOUND`); keeping any tsx involvement leaves a fragile launch.

**Probe koffi availability and fall back to pure-Node dialogs.** Out of scope: the lockfile resolves koffi to 3.1.1, and the worker crashed before koffi ever loaded, so koffi is not the failure on this codebase.

**Pass an explicit enabling flag to the child instead of sanitizing `NODE_OPTIONS`.** Rejected: Node has already renamed this feature's negation once (`--no-experimental-strip-types`, then `--no-strip-types`), so a hardcoded enabling flag couples the launch to a Node line, while removing both known disable spellings works across the engines range.

## Consequences

- Windows source launches (`pnpm dsh web`) run the worker directly under Node's native type stripping, so no loader chain can read the worker path as an `e:` scheme URL.
- Packaged hosts keep the unchanged CJS worker arm and an untouched `NODE_OPTIONS`.
- The source arm depends on the engines range, a package-local erasable-only graph, marked type imports, and removal of inherited type-stripping disable flags; [the package README](../../../../packages/host/directory-picker-native/README.md) states those preconditions for consumers.
- The Win32 smoke reaches the real source launch even where a module runner decorates URLs with query strings.

## Verification

- `packages/host/directory-picker-native/tests/win32-dialog-host.spec.ts` pins the source launch: `process.execPath` runs the worker path as the sole positional argument, with no loader flag.
- The same suite covers the three `NODE_OPTIONS` cases — a mixed string keeps its unrelated entries and leaves the parent untouched, a string of only disable flags leaves the variable unset, and an unset variable stays unset.
- `tests/win32-dialog.spec.ts` launches the real source worker on POSIX. A non-erasable construct or an unmarked type import makes that launch exit before reporting, so the test fails on the worker-exit rejection instead of the expected `win32 folder dialog failed`.
- On win32 the same suite opens and abort-closes a real dialog through the source arm; `tests/built-worker.e2e.ts` owns the packaged `worker.cjs` arm this decision leaves unchanged.
