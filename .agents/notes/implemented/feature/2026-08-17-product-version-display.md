# Agent Note: Product version display in the GUI

Status: implemented

English | [中文](2026-08-17-product-version-display.zh.md)

## Problem

A user who downloaded the DSHCode desktop app — or opened the Web GUI served by `dsh web` — could not tell which version was running. No surface inside the application showed a version number: not the sidebar, not the settings dialog, not the window chrome. Support reports and update checks had to fall back on the installer filename or the OS program metadata, both invisible once the app is running. The GUI is shared between the desktop shell and the browser, so any display had to work in both environments.

## Decision

The product version resets to its own line — `1.0.0`, advanced as `1.0.1` and so on — instead of tracking the upstream harness `0.1.0-rc` series. The workspace already shares one version: `check-workspace-constraints` requires every `@deepseek-ai/dsh-*` package to equal the root manifest, and `scripts/release/bump.ts` advances the family, the root, `apps/cli`, and `apps/web` together; `apps/desktop` (the `@dshcode/desktop` artifact) is bumped alongside. Desktop releases keep the `desktop-v*` tag prefix that `desktop.yml` builds and publishes from.

Two carriers bring the version into the browser, one per environment:

- **Desktop bridge** — `apps/desktop/src/main.ts` passes `app.getVersion()` through `desktopLaunchArguments` as `--dsh-app-version=<encoded>` (the product-name and version arguments ride on every platform, while the custom-frame argument stays Windows-only), `desktopBridgePayload` parses it into the bridge payload, and the renderer reads `window.dshDesktop.appVersion`. This is the packaged application's own version — the version the user downloaded — and stays authoritative for the desktop artifact even if a future desktop-only patch advances it alone.
- **Boot graph** — the client-modules node half reads its own `package.json` version once and injects it as `WebBootGraph.version` into `window.__DSH_BOOT__` alongside `rev` and `entries`. Its own manifest is co-located in every layout (source tree and packaged `node_modules`) and equals the product version by the workspace constraint, so no root-path resolution is needed. `parseBootManifest` validates the field at the wire boundary (a missing or non-string version throws, like every other wire member).

The display is shell chrome: [`VersionCaption`](../../../../packages/client/ui-renderer/src/client/VersionCaption.tsx) renders a muted, click-through caption (`position: fixed`, bottom-right corner, `pointer-events: none`) as a sibling of `DesktopTitleBar` in the shell assembly (`app.tsx`). It resolves the version through [`appVersion`](../../../../packages/client/ui-renderer/src/client/app-version.ts) — desktop bridge first, boot graph second — and renders nothing when neither carrier has one (isolated tests). Being shell chrome beside the frame, it floats over the layout in both the desktop window and the browser without touching any plugin's slots or the settings surface.

## Alternatives considered

**A version row inside the settings dialog or beside the sidebar Settings trigger.** Prototyped first (settings nav footer; trailing caption in the trigger row). Rejected for the shipped display because the version should be visible without opening settings — a support screenshot must carry it on its own — and the corner placement keeps the settings surface and the sidebar footer layout untouched. The carriers (bridge + boot graph) are the same either way, so moving the display cost nothing.

**Desktop bridge only, no boot-graph field.** The bridge covers the desktop shell, but a browser page served by `dsh web` has no bridge and would show nothing. The boot-graph field is what makes the same component work in the browser.

**A host API endpoint returning the version.** A new RPC surface for one static string that is already known at page-load time; the injected boot graph carries it without a round trip or a service addition.

**Reading the root `package.json` from the client-modules node half.** The root's location relative to the package differs between the source tree and a deployed `node_modules`, so the read would need layout knowledge. The package's own manifest is always one hop away and version-equivalent by the workspace constraint.

## Consequences

The boot-graph wire carries one more field: `WebBootGraph`/`BootManifest` types, the composed graph, `parseBootManifest`, the assembled-boot and HMR test fixtures, and the generated typert catalog (`api-catalog.ts`, regenerated) all moved together. The desktop launch arguments changed shape: every platform's renderer receives the product name and version, while the custom-frame argument stays appended by the caller on Windows only (passing it everywhere once drew the Windows chrome over the macOS title bar; the lifecycle tests pin the split). The desktop bridge type (`DesktopBridge.appVersion`) and the bridge fixtures in shell and plugin-installer tests carry the new member. The caption sits below popup layers (z-index under the frame's overlay layer and modal dialogs) and never intercepts pointer events, so it cannot block a control it overlaps.
