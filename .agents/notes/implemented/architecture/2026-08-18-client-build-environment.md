# Agent Note: Build-time public environment variables for client business code

Status: implemented

English | [中文](2026-08-18-client-build-environment.zh.md)

## Problem

Browser business packages need deployment builds to select static behavior, but the Web client has two artifact paths that do not contain one another: Vite builds the static shell, while the shared tsdown preset builds dynamically loaded plugins. Replacing an environment expression in only one path would give the same business expression different results depending on its package type.

Browsers have no Node `process`, and embedding the build process's complete environment object would expose values unrelated to the frontend. Runtime configuration also does not accurately represent a build variant because this choice must remain fixed after an artifact is published.

## Decision

`DSH_CLIENT_*` is the build-time namespace for values that may be exposed to browser business code. Business code may use a static property read such as `process.env.DSH_CLIENT_NAME` to select behavior. Values come only from the build process environment, not from Vite `.env*` files. Set values are inlined as strings, and unset values evaluate to `undefined`.

The Vite config and the shared tsdown preset for dynamic client bundles use one define generator. The generator creates exact substitutions only for `DSH_CLIENT_*` and reduces all remaining `process.env` reads to an empty object. The browser receives no global `process`, dynamic-key lookup, or environment enumeration capability.

The `DSH_CLIENT_*` prefix itself declares that a value is public. Credentials, paths, and other Host- or CI-only values must not use it.

The root build wrapper supplies one exact public environment to both bundlers. It derives `DSH_CLIENT_COMMIT_HASH` as the seven-character prefix of the source Git HEAD for every complete build; an explicit value supports build environments without repository metadata. `pnpm run build` otherwise inherits the caller's `DSH_CLIENT_*` values, while `pnpm run build:official` selects the repository's official artifact profile without shell-specific environment syntax and sets `DSH_CLIENT_BUILD_PROFILE=official` for deployment-specific business registrations. A successful complete build writes the exact public environment and a digest covering the Vite output and every dynamic client bundle. Partial build commands do not replace that record.

## Alternatives considered

**Replace values only in Vite.** A dynamic plugin's `lib/client.js` is loaded as an independent script and never enters Vite's module graph, so the expression would remain in a browser that has no `process`.

**Expose every `DSH_*` value.** Host, test, and CI variables already use that prefix and may contain credentials or local paths. The narrower `DSH_CLIENT_*` prefix makes exposure intent auditable.

**Provide a complete `process.env` object in the browser.** This would permit build-environment enumeration and turn a Node compatibility shim into a runtime API. Exact static substitutions are sufficient for build choices.

**Standardize on `import.meta.env`.** Dynamic plugins are emitted as independent CommonJS factories and cannot retain `import.meta`. Business code would still need two interfaces depending on the artifact path.

## Consequences

The Vite static shell and shared tsdown dynamic bundles receive the same string for a given `DSH_CLIENT_*` build-process variable. An unset static property read evaluates to `undefined`; non-`DSH_CLIENT_*` values cannot enter browser artifacts through this mechanism, and business code cannot enumerate the build process environment. Every complete build carries its short source revision as public display metadata. CI build gates select the official profile without exposing its public values to source tests or unrelated workflow steps. npm packing and built Web tests verify the recorded environment and current artifact digest, so a default build followed by an official pack request, a partial rebuild, or modified output fails before consumption.

Every `DSH_CLIENT_*` value referenced by business code becomes public artifact content, so a misnamed value can disclose information. Build choices are fixed when the artifact is generated; a setting that must change after deployment requires a validated, transported, and documented runtime configuration mechanism.
