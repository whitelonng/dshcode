# Agent Note: Desktop plugin boot-failure recovery

Status: implemented

English | [中文](2026-08-15-desktop-plugin-boot-recovery.zh.md)

## Problem

The desktop app boots one composed profile; any plugin that failed to import, rejected during activation, or hung at load aborted the whole tree, so the app could not open at all after installing an incompatible plugin. The only recovery was manual: edit `cordis.patch.yml` (or remove the install directory) by hand. A plugin's problem must never block the product; the app should surface the failure, let the user continue with the plugin disabled, and later let the agent fix the plugin from inside the running app.

## Decision

The desktop owns a recovery pipeline with four layers:

**1. Bounded failure records (`$DSH_HOME/boot-failures.json`, owned by `packages/host/plugin-installer/src/boot-failures.ts`).** A per-plugin ring, newest first: at most 8 records, per-record truncation (message 2 KB, stack 16 KB), one record per plugin (a new failure replaces the old), 90-day retention swept at write and read time, and a whole-file byte cap that drops oldest records. The file is bounded by construction — no background cleanup task exists. A malformed file fails loud on read, except the startup sweep, which degrades to empty (a diagnostics file must never block recovery). The safe-mode marker (`$DSH_HOME/safe-mode`) lives beside it. The desktop main process and the in-tree gateway share these helpers through the package entry's re-exports, so there is exactly one implementation of every file format.

**2. Startup lifecycle marker (`apps/desktop/src/boot-marker.ts`).** `$DSH_HOME/boot-marker.json` = `{ state: 'started' | 'ok', at, pid?, bootAttempts }`. Writing `ok` resets the consecutive-failure streak; a previous `started` without a following `ok` means the last launch died during startup. Hard crashes and main-thread hangs — which no JS catch can recover — are covered by this marker rather than by an error record.

**3. Watchdog and attribution (`apps/desktop/src/recovery.ts`).** The profile boot runs under a 60 s `withBootTimeout`; a timeout throws `BootHangError`. Attribution is deterministic: a thrown load failure is blamed on the installed plugins whose names appear in the failure text (the Loader's activation audit names every failed entry), a hang is blamed on plugins installed or updated after the last successful boot. Unattributable failures (a broken `cordis.patch.yml` parse, a broken bundle layer) get no blame list — the recovery dialog degrades to safe mode or exit.

**4. Recovery dialog and actions (`apps/desktop/src/main.ts`).** On failure the main process records the blame list, then shows a native dialog before any window: `继续（禁用插件并重启）` disables each blamed plugin through the installer's own `setPluginRowEnabled` (the same managed `insert`-row `disabled` rewrite the settings switch uses) and relaunches; `安全模式启动` sets the marker and relaunches; `退出` exits. After three consecutive failed launches the safe-mode button becomes the default. Safe mode flows into `runProfile` as `skipUserPatches` (profile + home user layers are skipped without parsing — a broken patch file is a recovery case, not a boot blocker — while bundle layers and overlays still apply). `runProfile` also gained a `failLoud` hook that reports late unhandled plugin-init rejections before the existing fail-loud exit; the desktop records an attributable late rejection in the ring.

**5. Plugin-list repair surface (`packages/client/ui-settings-plugin-installer`).** The host gateway serves `failures {}` → `{ items, pluginRoot, safeMode }` and `set-safe-mode { enabled }`; uninstalling a plugin clears its records. The tab renders a `启动失败` badge with the failure summary and two actions per matching row: `复制错误` (clipboard fallback for manual repair) and `让 Agent 修复`, which opens a conversation whose workspace is the plugin install root (`$DSH_HOME/profiles`, resolved idempotently via `workspaces.create`, renamed to `DSH 插件` on fresh creation), connects a blank session, and seeds the first message with the failure record and install path — the agent edits the plugin inside its workspace boundary, and the first message is self-contained so no out-of-workspace read is needed. A safe-mode banner explains the skipped user layers and offers `恢复正常模式并重启`.

## Alternatives considered

**Same-process fault tolerance (mount the failing entry as disabled and continue).** Rejected: it requires changing the vendored Loader's transactional rollback semantics and tolerating half-registered services from a plugin that threw mid-`apply`; the disable-then-relaunch path reuses the existing restart channel and the existing patch-row writer.

**Agent-driven install-time conflict checks.** Rejected: the loader's real boot is the authoritative conflict detector; a pre-install AI reading of plugin code would be a non-authoritative signal. The recovery flow already delivers the authoritative error to the user, and install-time preflight remains a deferred milestone (M11).

**A growing error log.** Rejected: the ring is bounded by construction at every write, with lifecycle cleanup (re-enable success, uninstall) instead of a background janitor.

## Consequences

- A broken user plugin now degrades to: dialog → disable → relaunch → badge + repair conversation, or safe mode. Built-in (bundle-layer) plugin failures still fail loud — that is a product bug, not a user-plugin problem.
- Hang attribution is a heuristic over "installed since the last successful boot"; multiple simultaneous installs may over-disable. Safe mode is the reliable fallback.
- Hard crashes and main-thread hangs leave no failure record; the boot marker covers those recovery paths (recovery prompt on the next launch when the streak continues).

## Related

- [User plugin install and update](../../implemented/architecture/2026-08-14-user-plugin-install-and-update.md) owns the install pipeline and the managed patch-row formats this recovery flow reuses for disabling; the `failures`/`set-safe-mode` endpoints extend that gateway.
