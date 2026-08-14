# Agent Note: DSHCode system tray and close-to-tray window policy

Status: implemented

English | [中文](2026-08-14-desktop-tray-and-close-to-tray.zh.md)

> Scope: the desktop application shell only — tray presence and actions, the close-to-tray window policy, and removal of the default Electron menu bar on Windows and Linux. Extends the [DSHCode Electron desktop shell](2026-08-13-electron-desktop-loopback-shell.md) decision.

## Problem

On Windows, the desktop window rendered two full-width rows at the top: the native title bar (application name plus the window controls) and, below it, Electron's default menu bar (File/Edit/View/Window/Help). The menu row belonged to neither the title nor the window buttons, looked disproportionately wide, and is the standard complaint against unmodified Electron windows.

The desktop shell also had no background presence. Closing the window exited the application on Windows and Linux, so there was no way to keep the Harness tree running without an open window, and no entry point to bring it back. The product request is a system tray by default: launch/restore the window from the tray, quit from the tray context menu, and hide to the tray when the user clicks the window close button.

## Decision

### Tray ownership lives in the main process

`apps/desktop/src/main.ts` installs one `Tray` after the application is ready, from packaged `assets/` icons resolved beside `lib/` through an ESM-safe `mainDir` (`fileURLToPath(new URL('.', import.meta.url))` — the ESM main has no `__dirname`): the colored app logo on every platform, with macOS loading `tray16.png` (16 px) and `tray.png` (32 px) as an explicit 1x/2x representation pair so the menu bar logo stays crisp on Retina displays. Windows and Linux wire `tray.on('click')` to show the window; macOS follows the platform convention where clicking the tray opens the context menu. The context menu offers 显示主界面 (show main window) and 退出 (quit). Tray creation is guarded because some Linux desktops provide no tray host; the close policy then degrades to a real close.

The tray show action reuses one `showMainWindow()` helper: a minimized window restores, a hidden one shows and focuses, and a destroyed window is recreated against the still-running application URL. The Electron single-instance `second-instance` handler now calls the same helper, so a repeated launch also resurrects a tray-hidden window.

### Close hides unless a real quit owns teardown

The window `close` event is intercepted: unless a `quitArmed` flag is set, the close is prevented and the window hides. The flag is set on the tray 退出 action and in the `before-quit` handler, which already owns the real quit path (`requestQuit` → Harness shutdown → `app.exit`). `window-all-closed` therefore fires only while a real quit is closing the window, and its existing handler stays harmless. With the tray unavailable (no tray host), the close policy cannot hide, so closing really closes the window as before.

The pure policy lives in `apps/desktop/src/lifecycle.ts` (`windowCloseDisposition`, `buildTrayMenu`, `trayIconFile`) so the vitest node suite pins it without loading Electron.

### Default menu removal on Windows and Linux only

`Menu.setApplicationMenu(null)` runs on Windows and Linux, removing the full-width default menu row. macOS keeps its system menu bar — the app menu, standard edit roles (copy/paste accelerators), and Cmd+Q — which is the platform convention and cannot merge into an in-window row. Application commands on Windows and Linux are owned by the tray context menu and the embedded Web UI. A custom single-row title bar is a separate follow-up decision.

## Verification

The desktop lifecycle suite gains three cases: the close disposition hides unless a quit owns teardown, the tray menu template wires the show and quit callbacks with the expected Chinese labels, and the tray icon file selection returns the 16 px logo on macOS and the 32 px one elsewhere. Desktop typecheck and the packaging path are unchanged in shape; the stage now copies `assets/` into the packaged app so the tray resolves its icons, covered by the existing production-stage smoke. Windows tray behavior (click-to-show, context menu, close-to-tray) is verified manually on the native Windows packaging job.

## Alternatives considered

**Keep the default menu and add the tray only.** Rejected: the wide menu row was the reported defect; keeping it leaves the title-bar complaint open.

**Draw window controls in the renderer now (frameless window).** Rejected: it requires a preload/IPC bridge, drag-region styling, and platform branches; the tray and close policy are independent and land first. A custom title bar is the next desktop-shell step.

**Hide instead of close unconditionally, with no quit flag.** Rejected: the quit path would then hide and never exit; the flag keeps one exit path owned by the existing shutdown coordinator.

**Quit on window-all-closed as before, with the tray as an opt-in.** Rejected: the product request is tray by default with close-to-tray as the default behavior.

## Consequences

- The application has a persistent background presence: the window can hide to the tray, the Harness tree keeps running, and the tray restores the window (also from a repeated launch).
- Real exit on Windows and Linux flows through the tray 退出 item and still awaits the Harness shutdown controller; accidental window closes no longer terminate the application.
- Windows and Linux windows no longer render the default menu bar; macOS is unchanged.
- A desktop without a tray host falls back to the previous close-quits behavior instead of erroring.
- The packaged app ships two colored tray icons in `assets/` (`tray.png` 32 px and `tray16.png` 16 px) generated from `icon.svg` with rsvg-convert; the runtime resolves them from `mainDir/../assets`, which works in development and in the unpacked packaged layout.
