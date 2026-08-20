# Agent Note: DSHCode single-row Windows title bar

Status: implemented

English | [中文](2026-08-14-desktop-single-row-title-bar.zh.md)

> Scope: the desktop application shell — the custom single-row title bar on Windows, the sandboxed preload bridge, and the window-menu IPC. Follows the [system tray and close-to-tray](2026-08-14-desktop-tray-and-close-to-tray.md) decision, which removed the default menu bar and defined tray ownership.

## Problem

After removing the default Electron menu bar, Windows still rendered two stacked rows: the native title bar (product name plus window controls) above the application content. The product requirement is one row containing the application name, the menu, and the minimize/maximize/close buttons — the VS Code layout. A renderer-drawn bar needs an Electron surface to reach window controls, but the renderer is context-isolated, sandboxed, and Node-free by the shell's security posture, so it cannot call Electron APIs directly.

## Decision

### Windows: hidden title bar plus native overlay controls

On Windows only, the main window uses `titleBarStyle: 'hidden'` with `titleBarOverlay` (white overlay, dark symbols, 38 px height, matching the shell's light-theme base surface). The operating system draws the minimize/maximize/close buttons on the same row; a theme-driven overlay color is a follow-up. macOS and Linux keep their native title bars.

### The preload bridge is the only new renderer surface

A new sandboxed preload (`apps/desktop/src/preload.ts`) exposes `window.dshDesktop` through `contextBridge`: the frame mode (`custom` on Windows, `native` elsewhere), the product name, the application version, and `showMenu()` invoking the `desktop:show-menu` IPC channel. The main window passes the product name and version as launch arguments on every platform and appends `--dsh-frame=custom` on Windows only — a native-frame platform must never receive the frame argument, or the renderer would draw the Windows chrome over the system title bar (the version fact was added by the [product version display note](../feature/2026-08-17-product-version-display.md)) — so the bridge payload parsing lives in `apps/desktop/src/lifecycle.ts` where the node test suite covers it without loading Electron. Sandboxed preloads cannot load ESM, so the desktop tsdown config builds the preload entry as CommonJS (`lib/preload.cjs`) beside the unchanged ESM `lib/main.js` (both entries build in both formats; two inert sibling outputs remain, documented in the config).

The `desktop:show-menu` handler validates the sender frame against the exact application origin before popping a native menu built from a pure template (隐藏到托盘 / 重启应用 / 退出). The restart action queues `app.relaunch()` before the armed-quit path (packaged Electron cannot hot-apply host plugins, so the plugin-management surface restarts the whole application in place); the quit action reuses the armed-quit path of the close-to-tray policy.

### The web shell renders the bar only on a custom frame

The shell assembly (`packages/client/ui-renderer/src/client/app.tsx`) wraps the root-slot render in a `DesktopTitleBar` component. Without the bridge, or with a native frame, the component renders its children unchanged — plain browsers and macOS see zero layout difference, so existing snapshots and e2e coverage stay valid. On a custom frame it renders a draggable strip (product name + menu button, `-webkit-app-region: drag` with a no-drag button) positioned absolutely over the top 38 px, while a padded body host keeps the application frame at full height; `env(titlebar-area-width)` keeps the content clear of the native overlay buttons.

## Verification

The desktop lifecycle suite pins the bridge payload round-trip (custom frame + encoded product name, native default, absent product name), the sender-origin validation, and the window-menu template wiring. The client-web suite renders the wrapper in all three modes (no bridge, native frame, custom frame) and asserts the menu button calls the bridge. Desktop and client typechecks pass; the assembled Windows behavior (single row, drag, overlay buttons, menu popup) is verified manually on the native Windows packaging job.

## Alternatives considered

**Fully frameless window with renderer-drawn window buttons.** Rejected: it duplicates the native controls, needs maximize-state IPC for icon swapping, and Windows snap/DPI quirks with `frame: false` are a known source of jank; the overlay keeps native behavior at zero renderer cost.

**Render the top bar from a profile-layer client plugin (like the compat shim).** Rejected: the seat it would need is shell-authoritative, and a plugin-owned chrome strip would couple the window's drag region to a removable package. The bar is shell chrome, so the kernel assembly owns it.

**Preload as ESM.** Rejected: sandboxed preloads cannot load ESM; the preload is built as CommonJS and stays the only Electron surface the renderer sees.

**Theme-sync the overlay color via IPC now.** Rejected: the overlay starts on the light-theme surface that matches the window background; dark-theme sync is a small follow-up that does not change the layout decision.

## Consequences

- Windows shows the application name, the menu button, and native window controls on one row; the default wide menu row is gone entirely.
- The renderer gains exactly one new surface — the preload bridge — and it is read-only except for the origin-validated menu RPC; context isolation and the Chromium sandbox stay enabled.
- Plain browsers and macOS render output is byte-identical to before, so shared-shell tests and snapshots remain the assembled-application coverage.
- The desktop bundle now emits `lib/main.js` (ESM, unchanged) plus `lib/preload.cjs` (CJS) and two inert siblings; the packaged app ships them through the existing `lib/**/*` files entry.
- The overlay color is fixed to the light-theme surface until a theme-driven update lands.
