# Agent Note: Client shell layering and dynamic package boundaries

Status: implemented

English | [中文](2026-08-15-client-shells-and-dynamic-packages.zh.md)

> The [client plugin loading model](2026-07-23-client-plugin-loading-model.md) owns module arrival, Cordis lifecycle, and HMR. This note owns package placement, build faces, shared module requests, and npm dependency declarations; those decisions supersede the older package taxonomy and import-edge rules in the loading note.

## Problem

Client npm dependency sections describe installation and development relationships, but they do not reliably describe bundle contents. Treating `dependencies`, `peerDependencies`, or `devDependencies` as implicit bundler instructions can inline a shared React or workspace identity, or leave a built library carrying unresolved child imports without the host that is meant to assemble them.

The browser application also contains distinct roles: the HTML/Vite compilation entry, the framework-free Cordis startup kernel, static assembly libraries, and Loader-governed plugins. Early execution from HTML is an arrival policy, not a package kind. Runtime and modules need to arrive before the Vite main module while retaining ordinary `lib/client.js` artifacts and dynamic graph rows.

Shared UI libraries still expose synchronous TypeScript and React values to many consumers. Until those values move behind services or slots, making the libraries formal dynamic entries would preserve the value coupling while obscuring which module identity the shell must share.

## Decision

### Layers and build forms

| Layer | Members | Responsibility | Build and load form |
| --- | --- | --- | --- |
| Web compilation shell | `apps/web` | Owns `index.html`, Vite configuration, dist chunks, and static assets | Assembles final browser output from built package exports |
| Startup kernel | `packages/client/web` | Owns the plain-DOM boot page, module-system wiring, Cordis settlement, and renderer handoff | `staticLinked` `lib/index.js`; no `dsh.client` row |
| Static assembly libraries | Cordis, `ui-primitives`, `ui-slots` | Supply shared module identities and direct value APIs | ESM `lib/index.js`, merged and chunked by Vite; not Loader entries |
| Module bootstrap | `packages/client/modules` | Supplies the client module table and its Cordis wrapper | Dynamic package with one ordinary `lib/client.js`; the host delivers its factory early |
| Dynamic client packages | runtime, `ui-renderer`, theme, and feature plugins | Participate through Cordis services, slots, and effects | Declare `dsh.client`, emit self-registering `lib/client.js`, and remain host-graph entries |

`packages/client/web` keeps Cordis as matching peer and development dependencies and uses modules and static UI packages as development compilation inputs. `apps/web` consumes built package exports rather than aliases into workspace source.

The `staticLinked` preset leaves every bare specifier as an external import in `lib/index.js` and emits relative CSS assets beside it. The Vite host resolves and deduplicates those imports and decides final chunk boundaries. A static library therefore does not copy the host's bundling policy into its own artifact.

### Shared module requests

Dynamic browser bundles implicitly externalize the common baseline: `PLATFORM_MODULES` names shell-seeded React, Cordis, and static UI identities, while `PRELOADED_CLIENT_EXTERNALS` names runtime's parser-preloaded dynamic identity. A package uses `dsh.client.external` only for an exact non-baseline value request. Type-only imports are erased and create no request; permitted third-party implementation libraries remain private bundle contents.

A request has exactly two suppliers:

1. The dynamic package row it names; a trailing `/client` aliases that package row.
2. An exact key in the shell's static module table.

There is no general `dsh.client.provide` alias mechanism. Dynamic rows and static keys exhaust the real suppliers, while Cordis service provision remains independent. Graph composition rejects malformed or missing requests, self-requests, and synchronous request cycles, and orders dynamic suppliers before their consumers. `ClientModuleSystem.import()` and `prefetch()` recursively register those dynamic supplier factories before the consumer can materialize, so network timing cannot violate the synchronous request graph.

### Parser preloading and React handoff

The modules Node half injects the startup protocol into the served HTML in this order:

1. Install `window.__ModuleLoader__` in queue mode with `pendingQueue`, `load()`, and `create()`.
2. Execute the modules graph row's ordinary `lib/client.js` as a blocking classic script.
3. Execute runtime's ordinary `lib/client.js` the same way.
4. Assign `window.__DSH_BOOT__`.
5. Execute the Vite main module.

Both early scripts only register factories. The startup kernel passes the raw graph and shell seeds to `__ModuleLoader__.create()`. The facade removes the modules registration, materializes it with a `require` function that rejects every external, and invokes its `createClientModuleSystem` export. The modules bundle parses the graph, constructs `ClientModuleSystem`, caches its own exports as the modules row, and retains the system in a module closure. Construction switches the same facade to live mode before draining runtime's pending factory. The modules client face consequently has a zero-runtime-external bootstrap requirement.

After the `immediately` tier has registered its factories, the kernel creates all Loader entries, awaits Cordis quiescence, and requires every fiber to be ACTIVE. It then calls `ctx.uiRenderer.mount(container)`. The dynamic `ui-renderer` package owns React, slot rendering, hydration of the existing boot DOM, and the React root lifecycle; the startup kernel and failure page remain React-free.

### Dependency declarations

Every client package keeps Cordis in matching `peerDependencies` and `devDependencies`. A dynamic package that imports, re-exports, augments, or names an internal dynamic package in `dsh.client.inject` keeps that package as matching peer and development dependencies. Static client inputs and React modules are development-only inputs for a dynamic package because the shell supplies their runtime identities.

Ordinary installed libraries remain `dependencies`: a dynamic build may bundle a private implementation, while a `staticLinked` library retains its bare import for the final host. Each build face decides externality independently from npm sections. Published file lists cover every runtime entry, relative asset, and declaration file reached by the artifact.

`verify-client-packages` enforces these classifications, dependency sections, build forms, parser-preload alignment, shared-module requests, and module-graph acyclicity. The repository publint pass enforces publication closure. The verifier's `--fix` mode repairs only unambiguous manifest drift.

## Alternatives considered

**Convert every client package into a dynamic plugin immediately.** `ui-primitives` and `ui-slots` still provide synchronous values without independent service or slot lifecycles; a manifest declaration alone would not remove those imports.

**Generate a separate `client-static.js` for modules or runtime.** Both packages remain dynamic graph rows and Cordis plugins; only their factory arrival is early. A second artifact would encode host policy in a filename and create two runtime products from one source.

**Compile all shared modules into the Vite entry.** This would remove deployment composition and plugin-level replacement from business plugins, including the renderer and theme.

**Retain a general module-provider declaration.** Package rows and exact static keys already name all suppliers; aliases would add another ownership protocol without a third supply source.

**Hardcode preload URLs in `apps/web/index.html`.** URLs and `rev` values belong to the host's current graph. Rewriting the served HTML keeps the queue, bundle URLs, and manifest on one graph revision.

## Consequences

Bundle contents stay stable when an npm dependency moves between peer and development sections, because each build face declares externality directly. Static libraries remain host-assembled, while dynamic packages retain uniform artifacts and lifecycle governance.

The startup protocol depends on the modules and runtime package ids, and modules must remain self-contained at runtime. A missing bootstrap registration fails before Cordis starts; later plugin import, apply, and service-wait failures remain visible through the boot page's ACTIVE scan.

The shell consumes built `lib/` products, so source and browser artifacts can drift until the relevant build or watcher runs. Typechecking source alone does not prove the served application uses the same code.

The two static UI libraries remain deliberate exceptions. Converting either one to a dynamic package requires moving all value consumers to services or slots and removing its identity from the static seed in the same change.
