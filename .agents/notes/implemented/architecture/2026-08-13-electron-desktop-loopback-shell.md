# Agent Note: DSHCode Electron desktop shell over ephemeral loopback HTTP

Status: implemented

English | [中文](2026-08-13-electron-desktop-loopback-shell.zh.md)

## Problem

The shipped graphical surface required a user to install Node.js, launch `dsh web`, keep a terminal process alive, and open the printed URL in a browser. DSHCode needs an installable macOS and Windows application that starts the unchanged Web UI by ordinary double-click, with no user-operated CLI.

A desktop owner must also control the Web service it starts. A fixed port can collide with another DSHCode or development process, a wildcard bind exposes the control surface to the LAN, and exiting Electron without disposing the Harness tree can leave sockets or subprocesses alive. Packaging adds a separate failure mode: pnpm workspace packages use required peers as shared Service Definitions, so a deployment can build successfully yet fail only when the Loader imports a peer omitted from the installed tree.

The [GUI layering decision](2026-07-19-gui-layering-and-rpc-protocol.md) leaves both same-origin Web carriage and a future Electron IPC carrier available. The existing Web profile already owns static assets, HTTP API routes, the [WebSocket downlink](2026-08-04-websocket-downlink-carrier.md), directory picking, and the complete browser plugin roster. Replacing that carrier would enlarge this first desktop change without changing the requested interface.

## Decision

### Application assembly

`apps/desktop` is the private `@dshcode/desktop` Electron application, with product name `DSHCode` and application id `com.whitelonng.dshcode`. Its main process calls the shared `@deepseek-ai/dsh/profile-boot` export and boots the existing `web` profile in-process; it does not spawn the CLI or a separately supervised server process. The upstream renderer bundles, interface, and application icon remain the inputs to this private preview.

`runProfile()` makes user patch-layer watching an explicit launcher choice. The CLI passes `true` and preserves its live `cordis.patch.yml` behavior. The desktop passes `false` because packaged Electron does not expose the Node loader internals required by Cordis HMR; both patch files are still composed at startup, and settings providers mounted by the Web profile retain their own live behavior.

The BrowserWindow keeps context isolation and Chromium sandboxing enabled, disables Node integration and webviews, denies renderer permission requests, and admits navigation only within the exact activated application origin. HTTPS destinations open in the system browser; other cross-origin destinations are rejected. Electron's single-instance lock focuses the existing window on a repeated launch.

### Service address and shutdown ownership

Every desktop launch passes `--host 127.0.0.1 --port 0` to the Web profile. Port zero delegates collision-free allocation to the operating system; the launcher builds the window URL from the host and actual nonzero port reported by the activated WebServer service, rejecting any non-loopback host or invalid port. No fixed DSHCode port exists.

The Electron quit path coalesces repeated requests, awaits the shared Harness shutdown controller, and calls `app.exit()` only after the tree settles. The WebServer disposer owns HTTP and upgraded sockets, so application exit closes the listener before the native process terminates. Closing all windows quits on Windows; macOS keeps normal application semantics and recreates the window from the still-running profile until the user quits the application.

### Packaged runtime

electron-builder consumes a production `pnpm deploy` staged outside the source workspace. `apps/desktop/package.json` directly declares every required workspace peer reachable from its runtime graph, and the generalized `verify-runtime-closure` gate checks that closure before each stage. This explicit list is distribution metadata: relying on development-workspace links or adding peers only after a runtime error is not an accepted packaging model.

The application uses unpacked resources rather than ASAR because the profile module fallback creates real filesystem symlinks to installed plugin packages. The stage carries the root MIT license and generated third-party notices; the notice generator classifies Electron as shipped runtime content even though it is a development dependency used by electron-builder. A native GitHub Actions matrix creates macOS arm64, macOS x64, and Windows x64 artifacts.

## Verification

The desktop lifecycle suite pins loopback/port-zero arguments, activated-address validation, navigation policy, packaged Electron's missing main-module argument, and coalesced shutdown ordering. The runtime-closure gate covers the installed workspace peer graph. A production stage smoke boots the real Web profile, receives HTTP 200 on the OS-assigned loopback port, disposes it, and observes that the port no longer accepts connections; a native Electron launch exercises the same stage and window. Platform CI builds each installer on its target operating system. The renderer, model-visible inputs, and transcript output do not change, so existing Web snapshots remain the assembled-application coverage rather than gaining a duplicate desktop transcript.

## Alternatives considered

**Load the built frontend with `file://` and no local HTTP service.** Rejected: the existing application depends on same-origin HTTP API routes and WebSocket upgrades. Replacing those with a new bridge changes the carrier and renderer behavior instead of packaging the current Web UI.

**Implement the reserved Electron IPC carrier now.** Rejected: IPC remains compatible with the client abstraction, but it requires a new transport implementation, preload bridge, validation surface, and lifecycle coverage. Loopback carriage reuses the shipped protocol unchanged and meets the no-CLI application requirement.

**Spawn `dsh web` as a child process.** Rejected: the installed application would need to locate or ship a second launcher, parse readiness output, forward environment and signals, and supervise teardown. In-process profile boot gives Electron direct ownership of readiness and shutdown.

**Reserve a conventional desktop port.** Rejected: any fixed number can collide with an existing DSHCode, CLI, test, or unrelated local service. Port zero removes the check-then-bind race and makes parallel independent launches safe even outside the single-instance product path.

**Package the application in ASAR.** Rejected: the current profile fallback must give the operating system real package paths as symlink targets. ASAR virtual paths do not satisfy that filesystem requirement.

**Depend only on `@deepseek-ai/dsh` and let pnpm infer peers.** Rejected: required workspace peers are shared runtime services, and auto peer installation is disabled by repository policy. The staged failure that motivated the closure gate proved that a small root manifest is not a closed executable deployment.

## Consequences

- Installed users launch one application without Node.js or CLI interaction, while maintainers keep one renderer implementation.
- DSHCode owns a private local HTTP listener during its lifetime, but the listener is loopback-only, uses an unpredictable available port, and closes before process exit.
- Manual edits to the profile or home `cordis.patch.yml` require an application restart; ordinary Web UI settings do not inherit that limitation.
- The desktop manifest has a long explicit peer list, and packaging fails early whenever a new required workspace peer is not added to it.
- Unpacked application resources are larger and more inspectable than ASAR, in exchange for correct plugin resolution on macOS and Windows.
- Source redistribution follows the upstream MIT notice, while public use of DeepSeek logos or other brand assets remains a separate permission requirement documented at the repository root.
