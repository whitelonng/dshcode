English | [中文](IMPLEMENTATION.zh.md)

# DSHCode Desktop: Implementation Plan and Change Log

> One document for the desktop product work delivered in this repository: what each milestone designed, **what it actually implements** (APIs, wire payloads, data structures, UI copy), the files it changed, and how it was verified. Per-decision rationale lives in the Agent Notes ([.agents/notes/implemented/architecture](../../.agents/notes/implemented/architecture/)).

## M1 System tray, close-to-tray, remove the default menu

### Design

The main process owns one `Tray`; closing the window hides to the tray unless a real quit owns teardown; Windows/Linux run without the default Electron menu bar.

### Implementation

**`apps/desktop/src/lifecycle.ts` (pure, unit-tested):**

- `windowCloseDisposition(quitArmed: boolean): 'hide' | 'close'`
- `buildTrayMenu({ show, quit })` → `[显示主界面, separator, 退出]` (labels in Chinese, product copy convention)
- `trayIconFile(platform)` → `tray16.png` on darwin, `tray.png` elsewhere
- `desktopLaunchArguments(productName, appVersion)` → `['--dsh-product-name=<encoded>', '--dsh-app-version=<encoded>']` (every platform; the caller appends `--dsh-frame=custom` on Windows only)
- `desktopBridgePayload(argv)` → `{ frame: 'custom' | 'native', productName, appVersion }`
- `desktopIpcSenderIsApplication(senderUrl, origin)` → origin check for IPC handlers
- `buildWindowMenu({ hide, restart, quit })` → `[隐藏到托盘, sep, 重启应用, sep, 退出]`
- Constants: `DESKTOP_SHOW_MENU_CHANNEL = 'desktop:show-menu'`, `DESKTOP_RESTART_CHANNEL = 'desktop:restart'`

**`apps/desktop/src/main.ts`:**

- `installTray()`: builds the tray icon under `mainDir` (`mainDir = fileURLToPath(new URL('.', import.meta.url))` — the ESM main has no `__dirname`); macOS composes an empty `nativeImage` with the 1x/2x colored-logo representations (`tray16.png`/`tray.png`), other platforms load `trayIconFile(platform)`; guarded by try/catch (no tray host → logged, close degrades to real close). Click wiring: **macOS** registers `tray.on('click') → showMainWindow()` (the primary click opens the window directly) and `tray.on('right-click') → tray.popUpContextMenu(menu)` — `setContextMenu` is skipped on macOS because a set context menu swallows the click event and would turn the left click into a menu popup. **Windows/Linux** keep `tray.setContextMenu(menu)` plus `tray.on('click') → showMainWindow()` (the menu opens on right-click there).
- `showMainWindow()`: restore if minimized, show+focus, recreate against `applicationUrl` when destroyed (shared by tray, second-instance lock, macOS activate)
- Close policy in `createMainWindow`: `window.on('close', e => { if (tray !== undefined && windowCloseDisposition(quitArmed) === 'hide') { e.preventDefault(); window.hide() } })`
- `quitArmed = true` set by the tray 退出 action, the window-menu 重启应用/退出 actions, and `before-quit` (which still routes through `requestQuit → Harness shutdown → app.exit`)
- `Menu.setApplicationMenu(null)` on win32/linux only (macOS keeps the system menu bar)

**Assets:** `assets/tray.png` (32 px) and `assets/tray16.png` (16 px), the colored app logo rendered from `icon.svg` with rsvg-convert. `installTray` loads both as an explicit 1x/2x representation pair on macOS so the menu bar logo stays crisp on Retina displays; Windows/Linux use `tray.png` directly.

**Packaging:** `electron-builder.yml` ships `assets/**`; `scripts/prepare-package.mjs` copies `assets/` into the staged app.

**Tests:** `apps/desktop/tests/lifecycle.spec.ts` — 12 cases (close disposition, tray/window menu labels + callbacks, icon selection, bridge payload round-trip, sender validation).

## M2 Single-row Windows title bar

### Design

Windows renders the product name, a menu button, and native window controls on one row via a hidden title bar plus `titleBarOverlay`; the renderer reaches the window menu through a sandboxed preload bridge.

### Implementation

**Window options (main.ts, Windows only):**

- `titleBarStyle: 'hidden'`, `titleBarOverlay: { color: '#ffffff', symbolColor: '#0f1115', height: 38 }`
- `webPreferences.preload: join(mainDir, 'preload.cjs')`, `additionalArguments: desktopLaunchArguments(PRODUCT_NAME, app.getVersion())` with `--dsh-frame=custom` appended only on the Windows custom frame (the renderer's version caption reads the app version on every platform; only Windows draws its own title-bar row)

**`apps/desktop/src/preload.ts` (sandboxed CommonJS; sandboxed preloads cannot load ESM):**

- `contextBridge.exposeInMainWorld('dshDesktop', { ...desktopBridgePayload(process.argv, process.platform), showMenu: () => ipcRenderer.invoke('desktop:show-menu'), restart: () => ipcRenderer.invoke('desktop:restart') })`

**IPC (main.ts, registered after the profile boots):**

- `desktop:show-menu` — sender validated by `desktopIpcSenderIsApplication` against the application origin, then `Menu.buildFromTemplate(buildWindowMenu({hide, restart, quit})).popup({ window })`
- `desktop:restart` — same validation, then `quitArmed = true; app.relaunch(); requestQuit(0)` (relaunch queued before shutdown so the process restarts however teardown settles)

**Web shell `packages/client/web/src/DesktopTitleBar.tsx` (+ `.module.css`):**

- Renders children unwrapped when `window.dshDesktop` is absent or `frame !== 'custom'` (browser/macOS output unchanged)
- Custom frame: absolute 38 px draggable strip (`-webkit-app-region: drag`) with product name + hamburger menu button (`no-drag`, aria-label 应用菜单), body padded `39px`; content width uses `env(titlebar-area-width, 100%)` to clear the native overlay buttons
- Wired into the shell assembly in `app.tsx`: `<DesktopTitleBar>{ctx.slots.renderSlot('root', {})}</DesktopTitleBar>`

**Build:** `tsdown.config.ts` exports two configurations — `lib/main.js` (ESM, referenced by package `main`) plus an inert `lib/main.cjs` twin, and `lib/preload.cjs` (CJS, the preload target) as its own single-entry build. The preload gets a dedicated build because a sandboxed preload cannot `require` sibling files, and one shared build would split the lifecycle module into a chunk the preload then fails to load; the lifecycle helpers are inlined instead.

**Tests:** `packages/client/web/tests/desktop-title-bar.client.spec.tsx` — pass-through without bridge, native frame, custom frame renders name and fires `showMenu`.

## M3 Archived-session management

### Design

Archive becomes manageable: durable session deletion in persistence, registry restore/remove, three workspace RPCs, and a settings page with restore and confirm-gated permanent delete.

### Implementation

**Persistence (host):**

- `SessionPersistence.delete(id: SessionId): Promise<void>` (abstract; new public method)
- `PersistenceBackend.deleteStored?(id, signal?): Promise<boolean>` (optional hook, like `loadStoredFrom`)
- `PersistenceCoordinator.delete(id)`: drops in-memory state, invalidates prepared reads, refuses loudly when the backend lacks `deleteStored`
- JSONL backend: resolves the log path via the existing id scan, removes the per-session directory
- SQLite backend: `DELETE FROM events WHERE session_id = ?; DELETE FROM sessions WHERE id = ?` in one transaction; returns false when absent
- Shared contract test in `packages/session/session-persistence/tests/contract.ts` runs on memory/JSONL/zstd/SQLite

**Workspace registry (host):**

- `restoreSession(sessionId)`: removes the id from `archivedSessionIds` (idempotent; accounting slot kept)
- `removeSession(sessionId)`: detaches the id from every owning workspace + removes it from the archive set (no-op for unknown ids)

**Wire (apiproxy):**

- `workspace.restoreSession { sessionId }` → `{ archivedSessionIds }`
- `workspace.deleteSession { sessionId }` → `{ archivedSessionIds }`; refuses `not-archived` (id not in the archive set) and `session-active` (live session); deletes the log first, then drops accounting
- `workspace.listArchived {}` → `{ items: [{ sessionId, title?, createdAt? }] }` (titles folded via `sessionQuery.readTitleSnapshots`, ages from persistence headers; degrades when sessionQuery is absent)
- New error codes in `api/rpc.ts`: `'not-archived'` and `'session-active'` (both `{ sessionId }`)
- `deleteSession` is deliberately NOT exposed to the agent tool catalog (destructive, user-surface only)

**Client runtime:** `workspaces` manager/service/contract gain `restoreSession(sessionId)` and `deleteSession(sessionId)`, installing the returned archive set through the existing `installArchived` projection.

**Settings page `packages/client/ui-settings-archive/` (new package):**

- Registers `settings.section` id `archive`, order 30, label 归档会话
- Row per archived session: folded title (fallback 未命名会话), id, 创建于 {time}; actions 恢复 and 彻底删除 (danger button + Modal: title 彻底删除会话, body 删除后会话日志将永久移除，无法恢复。附件文件可能仍占用存储空间。, actions 取消 / 确认删除)
- Wire face: `connection.rpc.call('/api', 'workspace.listArchived' | 'workspace.restoreSession' | 'workspace.deleteSession', …)`, responses validated in `protocol.ts`
- Empty state 没有归档的对话。删除工作区中的会话会先归档到这里。

**Snapshots:** 11 goldens refreshed — settings navigation gains the 归档会话 row (verified diffs contain only that addition).

## M4 In-place restart channel

- IPC `desktop:restart` (origin-validated): `quitArmed = true; app.relaunch(); requestQuit(0)` — the apply channel for profile/patch changes packaged Electron cannot hot-apply
- Exposed via the preload bridge (`window.dshDesktop.restart()`) and the title-bar menu item 重启应用

## M5 Plugin install and update pipeline

### Design

A loopback gateway owns user-plugin installs from npm specs or git URLs into the shared module fallback, with durable state, patch-layer rows, and update detection; a new settings tab drives it and ends with a restart affordance.

### Implementation

**Host `packages/host/plugin-installer/` (new package):**

- Gateway channel `/plugin-installer` (`authority: 'loopback'`), endpoints `list` / `install { spec }` / `update { id }` / `uninstall { id }` / `check-updates`; unknown endpoint → `bad-request`; zod-validated payloads; mutations serialized per instance
- Config: `{ profilePatchPath, dshHome?, registry? }` (registry defaults `npm_config_registry` then `https://registry.npmjs.org/`)
- **npm path** (`registry.ts`): `fetchPackument(name, registry)` (scoped names encoded as `@scope%2Fname`), `resolveNpmVersion(spec, packument)` (exact → semver range via `maxSatisfying`, prereleases excluded → `dist-tags.latest`), `installNpmPackage(...)` downloads the tarball and extracts with `tar.x({ cwd, strip: 1 })` into `$DSH_HOME/profiles/node_modules/<name>`
- **git path** (`git-source.ts`): `isGitSpec` recognizes `git+`/`git://`/`github:`/repository URLs (including `#ref` pins); GitHub repositories install from their codeload source tarball and resolve the commit through the GitHub API — no `git` binary, CDN-speed downloads, `GITHUB_TOKEN`/`GH_TOKEN` lifts the 60 req/h API limit — while other hosts shallow-clone (and GitHub URLs fall back to a clone when the tarball path fails and git exists); `installFromGit(url, dir)` stages into a temp dir, reads the package identity, moves it to the final location, records the HEAD commit; missing git → typed error
- **State** (`state.ts`): `$DSH_HOME/plugins.json` = `{ plugins: [{ id, name, version, source: { kind: 'npm' | 'git', spec }, installedAt, commit? }] }`; atomic write under a file lock; malformed state fails loud
- **Patch layer** (`patch.ts`): managed row `# dsh-plugin-installer: <id>` comment + `- id: <name>\n  name: <name>` inserted/removed in the profile `cordis.patch.yml`, preserving unowned nodes, comments, and `!!js` expressions (superseded by the `insert`-item format in Fix 4 — bare rows in the user layer are overrides and never mounted new entries)
- **Updates**: npm compares `dist-tags.latest` to the installed version; git compares remote HEAD to the recorded commit; offline/vanished sources are skipped per plugin
- Tests (14): state round-trips, spec parsing/semver resolution, patch-row preserve/remove, full gateway flow over a mocked registry (install → list → check-updates → update → uninstall) plus typed rejections

**Client `packages/client/ui-settings-plugin-installer/` (new package):**

- Registers `settings.plugins.tab` id `installer`, order 30, label 安装与更新
- Install box (placeholder npm 包名（如 @scope/name）或 git 仓库 URL), 检查更新 action, one row per plugin (version, 最新 {version} badge, 更新 / 卸载), confirm-gated uninstall Modal, and after any mutation a restart row 插件变更将在重启应用后生效。 + 重启应用 button calling `window.dshDesktop.restart()` (read via a local cast; the authoritative `Window.dshDesktop` type stays in the shell)
- Wire validation in `protocol.ts` (`parsePluginList` / `parseInstalledPlugin` / `parseUpdateList`)
- Tests (12): protocol rejection cases, tab flows, section registration

**Registrations:** `packages/bundle/web-app/cordis.patch.yml` (host + client rows), `web-app/package.json` (deps), `tsconfig.host.json` / `tsconfig.client.json` (references).

## M6 Merged plugin list, saved enablement, read-only built-ins

### Design

One **插件列表** tab replaces the three installer/control/inventory tabs: user plugins (and the deployment's preset products) on top with switches, update, and uninstall; the built-in Loader entries below, collapsed by default, searchable, and read-only. Enablement persists to the profile patch layer and applies at the next restart.

### Implementation

**Host `packages/host/plugin-installer/`:**

- New endpoints: `set-enabled { id, enabled }` (rewrites the plugin's managed patch item's `disabled` key) and `status {}` → `{ progress: { kind: 'idle' | 'install' | 'update', stage: 'fetch' | 'download' | 'extract' | 'write', percent? } }` — the browser polls `status` while a mutation runs and renders a progress bar; the tarball download reports percent from the response content length (the web stream is bridged to Node with byte counting)
- `list`/`install`/`update`/`uninstall`/`set-enabled` rows carry `enabled` derived from the managed patch item on every call (never stored in `plugins.json`)
- `validateInstallSpec(spec)` rejects anything that is neither a git source nor an npm-name pattern before any registry request — pasted prose or several URLs fail with `invalid install spec …: expected one npm package name (e.g. @scope/name) or one git repository URL`
- Registry fetches gained hard timeouts via `fetchWithTimeout` (30 s packuments, 60 s tarballs, honoring the caller's abort signal); 404 errors name the package (`package "x" not found — check the name or the configured registry`)
- Patch items now ride `insert` items (see Fix 4)

**Host `packages/host/plugin-inventory/`:** returned to read-only — the temporary `set-enabled` endpoint, its `profilePatchPath` Config, and its patch writer were removed after product feedback made built-ins read-only.

**Host `packages/host/plugin-control/`:**

- Each catalog item gains `packages` (module specifier per `entryIds` row, same order, schema- and runtime-validated)
- `set-enabled` writes one `insert` item marked `# dsh-plugin-control: <id>` carrying `{ id, name, disabled }` per row; enabling a never-mounted product now creates its rows instead of failing as `unavailable`; disabling with no mounted rows is already the effective state and writes nothing
- `list()` projects absent rows as `disabled` (not yet enabled), ambiguous duplicate ids stay `unavailable`, and the `desired` map overlays same-process feedback

**Client `packages/client/ui-settings-plugin-installer/` (the merged tab):**

- Registers `settings.plugins.tab` id `plugins`, order 10, label 插件列表 (was 安装与更新); the deleted `ui-settings-plugin-inventory` and `ui-settings-plugin-control` browser packages contributed no tabs anymore (their host gateways remain mounted)
- User section: install box, preset-product rows (`data-preset-plugin`, name + 查看源码 link + switch + state 已开启/已关闭/部分开启/不可用 + confirm-gated 卸载, switch disabled when `unavailable`), then installed rows (`data-user-plugin`, switch + version + 最新 {version} badge + 更新 / 卸载 with confirm Modal). A user switch reflects the host-computed `plugin.enabled` (an in-session overlay wins until the response lands); preset switches call `/plugin-control set-enabled`
- Built-in section: collapsed disclosure (`data-plugin-count`), search box, read-only rows (`data-plugin-entry`) with name and 已启用/已停用 only — no switches
- Progress UI while installing/updating: a determinate bar (percent) or an indeterminate animated bar with copy 正在获取插件信息… / 正在下载… / 正在下载 {percent}% / 正在解压… / 正在写入配置…, polled at 400 ms from the new `/plugin-installer status` endpoint; a failed poll stops silently
- Wire additions: `parseInstallStatus` and `parsePluginControlSnapshot` validators; `status()`, `controlsList()`, `controlsSetEnabled()` faces; `isLoopback` gate renders 仅限本机操作 notice outside loopback
- `package.json`: `@deepseek-ai/dsh-api-remotes` peer/dev dependency added for the `remote.pluginInventory` face

**Tests:** installer host 25 (progress, status endpoint, spec validation, insert-format rows), inventory 6 (read-only again), plugin-control 11 (absent-row enable, insert rows, uninstall markers + restore, catalog validation incl. `packages`), client 29 (preset rows + switch/uninstall flows, progress polling incl. unmount/failure, read-only built-ins, wire faces).

## M7 Preset products in the user section

### Design

The community products the distribution ships installed-but-off (`dsh-genui`, `dsh-annotation`, the nine-row `dsh-web-ui`) appear as switchable preset rows inside the user section of the merged plugin list — before the installed rows — instead of a separate switches tab.

### Implementation

- `packages/bundle/web-app/cordis.patch.yml`: the `plugin-control` catalog gained per-product `packages` (`@omdsh-dev/dsh-genui`, `@omdsh-dev/dsh-annotation`, and the nine `@linxin666/*` rows for web-ui) so enabling can mount rows whose ids were never present
- Client renders `data-preset-plugin` rows from `/plugin-control list` with switches wired to `set-enabled` and a confirm-gated 卸载 action wired to the new `uninstall` endpoint; the confirm Modal routes by row kind (`user` → installer uninstall, `preset` → control uninstall), and the response snapshot removes the row
- Note: a user-installed copy of the same package (e.g. via a git URL) takes precedence over the shipped dependency through the fallback rule in Fix 5

## M8 Startup-failure capture and recovery dialog

### Design

One broken plugin must never brick the desktop: boot failures are attributed to installed plugins, recorded in a bounded per-plugin ring, and surfaced in a recovery dialog that can disable the blamed plugins and restart, start in safe mode (skip the user patch layers), or exit. Hard crashes and hangs — which no JS catch can recover — are covered by a boot lifecycle marker plus a startup watchdog.

### Implementation

**`packages/host/plugin-installer/src/boot-failures.ts` (pure, shared by desktop main + gateway):**

- `$DSH_HOME/boot-failures.json` = `{ version: 1, failures: [{ pluginId, kind: 'load-failure' | 'hang' | 'late-rejection', message, stack, installPath, at }] }`, newest first
- Bounded by construction, no background cleanup: at most `MAX_BOOT_FAILURE_RECORDS` (8), per-record field truncation (message 2 KB, stack 16 KB), per-plugin replacement (one record per plugin), 90-day retention swept at write/read, and a whole-file byte cap (100 KB) that drops oldest records
- `writeBootFailure` / `readBootFailures` / `clearBootFailures` / `pruneBootFailures` / `agePrune` + the safe-mode marker (`$DSH_HOME/safe-mode`, `readSafeMode` / `setSafeMode`)
- Malformed files fail loud on read except `pruneBootFailures`, which degrades to an empty sweep (a diagnostics file must never block startup recovery)

**`apps/desktop/src/boot-marker.ts` (pure, unit-tested):**

- `$DSH_HOME/boot-marker.json` = `{ state: 'started' | 'ok', at, pid?, bootAttempts }`; `writeBootMarker(home, 'started')` continues the consecutive-failure streak, `'ok'` resets it — a previous `started` without an `ok` write means the last launch died during startup

**`apps/desktop/src/recovery.ts` (pure, unit-tested):**

- `withBootTimeout(promise, 60_000)` — the watchdog; timeout throws `BootHangError`
- `attributeLoadFailure(error, installed)` — installed plugin names appearing in the failure text (the Loader's activation audit names every failed entry)
- `hangSuspects(installed, lastOkAt)` — plugins installed/updated after the last successful boot
- `recoveryDecision` — `attributable` (blame list) vs `unattributable`; `recordBootFailures` writes one record per blamed plugin with the fallback install path; `clearResolvedFailures` drops the records of plugins that are enabled again after a successful boot

**`apps/cli/src/profile-boot.ts` + `packages/boot/app-boot/src/index.ts`:**

- `runProfile` gains `skipUserPatches` (safe mode: profile + home user layers are skipped *without parsing*, so a broken `cordis.patch.yml` is a recovery case, not a boot blocker; bundle layers and overlays still apply) and `failLoud` (reports a late unhandled plugin-init rejection before the existing fail-loud exit; CLI default behavior unchanged)
- `installFailLoud` gains an optional `report` hook invoked between the diagnostic and the exit

**`apps/desktop/src/main.ts`:**

- Boot sequence: read previous marker → write `started` → sweep the failure ring → read safe mode → `runProfile` under the 60 s watchdog (with `skipUserPatches` and `failLoud: reportLateRejection`) → on success write `ok` + clear resolved failures; on failure `handleStartupFailure` records and shows the recovery dialog
- Recovery dialog (`dialog.showMessageBox`, before any window): attributable → `继续（禁用插件并重启）` / `安全模式启动` / `退出`; unattributable → `安全模式启动` / `退出`; safe-mode-boot failure → `重启应用` / `退出`; after `CONSECUTIVE_FAILURE_THRESHOLD` (3) failed attempts the safe-mode button becomes the default
- 继续 disables each blamed plugin via the installer's own `setPluginRowEnabled` (writes `disabled: true` to the managed insert row), then `app.relaunch()` + `requestQuit(0)`; 安全模式 writes the safe-mode marker and relaunches
- `reportLateRejection` records an attributable late rejection before the hard exit; the boot marker covers startup deaths that produce no error

## M9 Safe mode

- Marker file `$DSH_HOME/safe-mode` (shared helpers in plugin-installer); the desktop reads it at launch and passes `skipUserPatches` to `runProfile`; it is sticky — the user decides when to leave it
- The plugin list tab shows a banner with a `恢复正常模式并重启` action (`/plugin-installer set-safe-mode { enabled: false }` + the desktop restart bridge; the web build falls back to the restart hint) and locks every enablement switch while safe mode is active

## M10 Plugin-list failure badge and the agent repair conversation

### Design

The plugin list surfaces recorded boot failures per plugin with a **启动失败** badge, an expandable summary, a copy affordance, and a **让 Agent 修复** action that opens a conversation whose workspace is the plugin install root (`$DSH_HOME/profiles`) and seeds the first message with the failure record — the agent edits the plugin code inside its workspace boundary, no folder picking and no approval friction for every file.

### Implementation

**Host (`packages/host/plugin-installer`):**

- Gateway endpoints: `failures {}` → `{ items, pluginRoot, safeMode }` (aged records, `dirname(fallbackModulesDir)`, marker state) and `set-safe-mode { enabled }`; `uninstall` also clears the plugin's failure records
- The shared boot-failures, patch-row, state, and fallback helpers are re-exported from the package entry so the desktop main reuses the exact same file formats

**Client (`packages/client/ui-settings-plugin-installer`):**

- `protocol.ts`: `PluginFailureItem` / `PluginFailuresSnapshot` + `parseFailuresSnapshot` validation
- Tab: failure badge + summary + `让 Agent 修复` / `复制错误` actions on the matching user-plugin row; safe-mode banner with the exit action; switches disabled in safe mode
- New inject members `failures`, `setSafeMode`, and `repairPlugin` (inject list gains `workspaces` and `sessions`); `repairPlugin` resolves the plugin-root workspace via `workspaces.create` (idempotent; a freshly created default-titled workspace is renamed to `DSH 插件`, rename conflicts never break the flow), connects a blank session via `workspaces.connectWorkspace`, seeds `prompt([{ type: 'text', text }], 'queue')` with the failure record + install path, then opens the session
- Product copy (zh): 启动失败 / 让 Agent 修复 / 正在创建修复对话… / 复制错误 / 已复制 / 安全模式：用户插件配置已跳过，插件开关不可用。 / 恢复正常模式并重启

**Tests:** boot-failures ring 11 (bounded rules, truncation, byte cap, age sweep, safe-mode marker), desktop marker/recovery 18 (streak counting, attribution, hang suspects, watchdog, record round-trips, resolved-failure clearing), gateway 12 (failures/set-safe-mode/uninstall-clears), client 37 (badge + repair message content, copy, safe mode banner + lock, wire faces), app-boot fail-loud report hook.

## Fix 1 Third-party model reasoning efforts

### Implementation (`packages/client/ui-settings-models`)

- `src/client/reasoning-efforts.ts` (new): `THINKING_LEVELS = ['off','minimal','low','medium','high','xhigh','max']`; `parseReasoningEfforts(text)` accepts `high: high, max: ultra` (comma-separated `level: spelling`; `off` may stand alone or carry empty spelling), empty text → unset; `formatReasoningEfforts(value)` reverses it; `INVALID_EFFORTS = 'invalid'` sentinel; `validReasoningEfforts(value)` guards unknown levels and empty non-off spellings
- `ModelListEditor.tsx`: disclosure gains the 推理等级 text input (buffer-per-row like capacities) and the 禁用推理 checkbox (`false`); unreadable text parks the sentinel in the draft
- `DeepSeekModelsEditor.tsx`: `validateDeepSeekModels` returns `{ index, key: 'modelReasoningEffortsInvalid' }` for the sentinel or invalid records — refused before any write
- Value lands verbatim in `providers.<route>.models[].reasoningEfforts` via the existing `settings.mutate` replace-array path (the pi-ai adapter already consumes it; the picker then offers the declared levels)
- Copy (zh): 推理等级 / 例如 high: high, max: ultra / 禁用推理 / 推理等级需为「等级: 拼写」对，逗号分隔，例如 high: high, max: ultra；off 可留空。
- Tests: `tests/reasoning-efforts.client.spec.ts` (parse/format/validate) + editor behavior cases (draft receives parsed values, sentinel refused, checkbox round-trip)

## Fix 2 describe-image client locale injection

- Root cause: published `@linxin666/dsh-tool-describe-image` 0.1.12 client bundle has `const inject = ["slots","conversation","sessions"]` but `apply()` starts with `ctx.locale.register(NS, dictionaries)` → `cannot get property "locale" without inject`
- Repository-side remediation: none needed (upstream fix = add `"locale"` to that inject list)
- Machine-side remediation applied: `~/.dsh/profiles/web/node_modules/@linxin666/dsh-tool-describe-image/lib/client.js` patched to `["slots","conversation","sessions","locale"]`; all `ctx.*` accesses in the bundle were cross-checked against the inject list

## Fix 3 Packaged-host plugin resolution

- Root cause: packaged Electron exposes no Node loader internals → `ModuleLoader.fromInternal()` returns undefined → `EntryTree.import` fell back to a bare dynamic import resolving from the loader module's own location (the app's `node_modules`), so profile-level plugins (home patch rows) could not load
- `vendor/loader/src/config/tree.ts`: new branch — when `ctx.baseUrl` is a `file://` URL, `const { createRequire } = await import('node:module')`, `const { pathToFileURL } = await import('node:url')`, `createRequire(ctx.baseUrl).resolve(name)`, then import the resolved `file://` URL. Dynamic imports keep the browser bundle clean (browsers inject their own `internal` and never enter the branch)
- Registered as vendor local modification **#19** in `vendor/README.md`
- Regression test in `packages/boot/app-boot/tests/user-patches.spec.ts`: forces `ctx.loader.internal = undefined` and loads a fixture package from the config-tree `node_modules`

## Fix 4 Installed plugins ride insert patch items

- Root cause (the "installed but never enabled / switch stays on after disable" bug): the installer wrote bare rows (`{ id, name }`) into the profile user patch layer. Bare rows in that layer are *overrides of existing entries* — a row whose id is not mounted yet is skipped with a warning, so the Loader never created the entries (verified against the real profile: 0 of 135 entries matched) and the browser's inventory join then fell back to "enabled"
- `packages/host/plugin-installer/src/patch.ts` rewritten: managed items are now `- insert: [{ id, name, disabled? }]` with the `# dsh-plugin-installer: <id>` marker; `readPluginRowEnabled` reads the inserted row (a legacy bare row reads as enabled and is replaced by the insert format on the next toggle); uninstall removes the whole item
- `packages/host/plugin-control/src/control-file.ts` written to the same `insert` shape (`PersistedPluginControl` now carries `rows: [{ entryId, package }]`)
- Tests: patch spec covers insert round-trips, idempotence, legacy-row replacement, invalid YAML; gateway specs assert the written YAML contains `insert:` and `name: <package>`

## Fix 5 Module fallback tolerates same-named user installs

- Root cause: `healProfilesModuleFallback` refused to boot when a real directory (a user's plugin-installer git install) sat where it wanted a symlink to the shipped dependency (`exists and is not a symlink; remove it …`), bricking startup after installing e.g. `dsh-annotation`
- `packages/boot/app-boot/src/profile.ts`: `ensureSymlink` now keeps a real directory when both the directory and the link target own a `package.json` with the same `name` (the user's install wins); foreign directories without a matching manifest still fail loud
- Tests: three new profile-spec cases (same-name directory kept with its version, different-name directory still throws, missing manifest still throws)

## Fix 6 Tray left click opens the window on macOS

- Root cause: `setContextMenu` on macOS swallows the tray `click` event, so the left click could never open the window
- `apps/desktop/src/main.ts`: macOS wires `click → showMainWindow()` and `right-click → popUpContextMenu(menu)` instead of `setContextMenu`; Windows/Linux are unchanged (M1 section updated)

## Fix 7 Skin-center patch normalization for empty documents

- Root cause: `useSkin` concatenated `stripManaged(readPatch(...))` with the rendered managed section. When the home patch still held an empty-document `[]` (older initializers), the result was `[]` followed by rows — invalid YAML, and the next boot failed with `failed to parse patches … end of the stream or a document separator is expected`
- `patches/@linxin666__dsh-client-ui-skin-center@0.1.2.patch`: `useSkin` normalizes the stripped base before rendering — a base of `""` or `"[]"` lets the managed section own the file (no bare `[]` left in front of rows); the patch was regenerated through `pnpm patch`/`pnpm patch-commit` into one consolidated, versioned patch file (the unversioned twin declaration and file were removed)
- Repaired the affected machine's `~/.dsh/cordis.patch.yml` in place (backup kept at `cordis.patch.yml.bak-*`): the stray `[]` header was dropped, the managed section untouched
- Upstream follow-up remains (see Known items)

## Fix 8 Preset restore action and git failure diagnostics

- Preset uninstall no longer hides the product: `list` reports a new `uninstalled` state (`PluginControlState` gains `'uninstalled'`), and the merged list renders 已卸载 with a 恢复 button that re-enables the product (clearing the marker) — no reinstall through a git URL required for the shipped products, whose packages already live in the dependency closure
- `gitRemoteHead`/`installFromGit` failures now fold git's stderr (bounded to 300 chars) into the error so a network stall reads as `git clone failed for <url>: … fatal: could not read from remote` instead of a bare message; `packages/host/plugin-installer/tests/git-source.spec.ts` (new, 12 cases) covers the previously untested git path end to end
- Repaired the affected machine's `~/.dsh/profiles/web/cordis.patch.yml` in place (backup kept): the `web-ui` uninstall marker was rewritten back to its nine managed rows

## Fix 9 Bundle-style plugin installs and git identity diagnostics

- Git specs are normalized before they reach `git` (`normalizeGitUrl`): the `github:user/repo` shorthand becomes `https://github.com/user/repo.git` (no reliance on the machine's insteadOf/ssh aliasing) and the `git+` prefix is stripped, so a pasted shorthand clones without local git config
- Git sources now validate the cloned checkout before anything is written: a repository whose root has no `package.json` fails with `the git repository <url> has no package.json at its root …` instead of a bare `ENOENT`; a multi-package workspace root (`private: true` or declared `workspaces`) and an invalid package name are rejected with typed errors naming the URL (`validateGitIdentity`, 4 new cases in `git-source.spec.ts`). `readInstalledIdentity` gains the source context and the missing-manifest typed error; both helpers are exported for the desktop shell's recovery reuse
- Bundle-style plugins (npm or git packages declaring `dsh.bundle.patch`, e.g. `@linxin666/dsh-web-ui-all` — the "全家桶" aggregator whose own entry mounts nothing) now install their full support surface:
  - `installPackageDependencies` (new `dependencies.ts`) walks the package's transitive npm `dependencies` into the flat fallback — an existing copy is replaced only when its version differs from the resolved target, so an aggregator install upgrades the app-shipped web-ui family (0.1.2 symlinks) to the aggregated version while matching copies and the app closure stay untouched; cycles and diamonds install once via the visited set
  - `mergeBundleRows` (new `bundle.ts` row family, marker `# dsh-plugin-bundle: <id>`; the low-level patch-file helpers moved to `patch-document.ts`) merges the bundle's own patch items into the profile user patch layer: insert rows whose ids the patch already owns (a preset product row, the plugin's own installer row) are skipped so no entry mounts twice, bare override rows append verbatim, `!!js` expressions round-trip, and a re-install or update replaces the plugin's earlier merged rows
  - `uninstall` removes the merged bundle rows (installed dependency packages stay in the fallback as untracked support files), and `set-enabled` mirrors the plugin's flag onto them so the family switch controls the whole group
- Verified end to end against the live registry: installing `@linxin666/dsh-web-ui-all` into a temp home lands the aggregator plus all twelve `@linxin666/*` children at the resolved version in the fallback and merges all twelve bundle rows
- Refactor: bundle support moved to `src/bundle.ts` (rows + `bundlePatchPath`), shared patch-file helpers to `src/patch-document.ts`; `patch.ts` keeps installer rows, `index.ts` keeps gateway orchestration; bundle-row tests moved to `tests/bundle.spec.ts`
- Tests: package suite 88 green incl. git-source end-to-end over a mocked `git` child process (identity validation, dependency tree, bundle rows, update cycle), registry error branches, and the full guard-branch matrix; the host package sits at 100% statements/functions/branches in the scoped coverage run

## Fix 10 CLI `dsh plugin add` auto-approves refused build scripts

- pnpm ≥10 exits non-zero with `ERR_PNPM_IGNORED_BUILDS` when a dependency declares build scripts, leaving `allowBuilds: { <pkg>: 'set this to true or false' }` placeholders in the profile's `pnpm-workspace.yaml` — `dsh plugin --profile web add @linxin666/dsh-web-ui-all` failed after the packages were already written, and the bundle reconciliation never ran
- `apps/cli/src/plugin.ts`: `approvePendingBuilds` fills pnpm's placeholders with `true` (existing user-set entries stay untouched; malformed or missing workspace files are pnpm's own errors), and `runPlugin` retries the exact pnpm command once after approving, then reconciles on success — the explicit `add` command gets the pre-v10 build behavior instead of a half-applied failure
- Verified end to end in a fresh temp home: `dsh plugin --profile web add @linxin666/dsh-web-ui-all` exits 0 after building `ssh2`'s native binding, and `dsh.profile.bundles` gains the aggregator, so its patch applies as a bundle layer at boot (loader entries with duplicate ids are replaced in place, last layer wins — preset product rows keep their saved state over the colliding bundle rows)
- Tests: `apps/cli/tests/plugin.spec.ts` (new, 4 cases: placeholder approval, clean/malformed/missing workspace files, retry-then-reconcile flow, no-approval failure)

## Fix 11 pnpm delegation, SRI integrity, and the plugin discovery layer

- **SRI integrity**: `installNpmPackage` hashes the tarball bytes while streaming and verifies the packument's `dist.integrity` (sha256/384/512; unsupported algorithm sets fail loud); the pinned integrity is recorded in `plugins.json` (`integrity?` on the record) — the README's "not integrity-pinned" limitation is closed
- **System-pnpm delegation (mode A)**: the gateway probes `pnpm --version` once (memoized); when available, `install`/`update`/`uninstall` forward to `pnpm add`/`remove` in the web profile workspace (approving pnpm ≥10's refused build-script placeholders and retrying once), and the installed form decides the mount point — a `dsh.bundle` package joins `dsh.profile.bundles` (no installer row; disablement writes bundle-marker override rows for its patch ids via `setBundleLayerEnabled`/`readBundleLayerEnabled`), a plain package gets a managed insert row. Machines without pnpm keep the self-rolled paths unchanged
- **Discovery layer**: `$DSH_HOME/plugin-sources/{sources.yml, lock.yml, cache/<source>/entries.json}` — index source set with `official|community|untrusted` trust levels (the dsh-external hub catalog is the seeded default), TOFU locks pinning each install's resolved reference, and per-source enumeration snapshots (TTL 6h + ETag 304 + local file channel). Gateway endpoints `search`/`sources`/`add-source`/`remove-source`; the plugin list gains a 浏览插件 section (search box, install-from-result, source management); `plugin_search`/`plugin_install`/`plugin_uninstall`/`plugin_status` join the model-facing tool catalog (`docs/tool-catalog.md` regenerated, catalog manifest + spec updated)
- Verified end to end: real-pnpm delegation installed `@linxin666/dsh-web-ui-all` into a temp profile's bundle layer stack with zero patch rows; the hub-catalog enumeration degrades per source; host package tests 146 green at 100% statements/functions/branches; `test:gui` 289 files / 3992 green
- The 2026-08-15 17:35 rebuild ships all three: the packaged installer lib carries `plugin_search` registration, `normalizeGitUrl`, `pnpm add` delegation, and the `plugin-sources` discovery layer, and the client bundle renders the 浏览插件 section; DMG + ZIP regenerated beside the app

## Fix 12 GitHub installs ride codeload tarballs and the GitHub API

- Root cause: the self-rolled git path (machines without pnpm) installed GitHub plugins with `git clone --depth 1` (120 s cap) and `git ls-remote` (30 s cap) — GitHub's smart-HTTP clones stall easily, the machine needs a `git` binary at all, and every catalog install paid the full clone cost
- **GitHub tarball path** (`git-source.ts`): `parseGithubUrl` extracts owner/repo/ref from the normalized URL (`github:user/repo` shorthand expands in `normalizeGitUrl`, which now preserves a `#ref` pin; `isGitSpec` accepts pasted `https://github.com/user/repo#ref` URLs). `installFromGithub` downloads `https://codeload.github.com/<owner>/<repo>/tar.gz/<ref|HEAD>` (CDN, no pack negotiation) and extracts with `tar.x({ strip: 1 })`; `githubCommitSha` resolves the commit via `https://api.github.com/repos/<owner>/<repo>/commits/<ref|HEAD>`, with `GITHUB_TOKEN`/`GH_TOKEN` lifting the unauthenticated 60 req/h limit — GitHub installs now need no `git` binary at all
- **Fallbacks**: a GitHub URL whose tarball path fails falls back to the shallow clone when `git --version` probes successfully, except a codeload 404 — the repository does not exist, so a clone would hang on the same miss and the verdict is final; `gitRemoteHead` tries the API first and falls back to `ls-remote`; non-GitHub hosts keep the clone path unchanged. Hard timeouts sized for slow, rate-limited networks: 30 s API, 300 s tarball, 60 s ls-remote, 300 s clone
- Verified: `packages/host/plugin-installer/tests/git-source.spec.ts` rewritten (tarball extraction fixtures, API/fallback matrix including the codeload-404 finality, 39 cases), the gateway end-to-end git test now stubs codeload + commits and asserts no clone runs, host package tests 166 green; `dsh-api-balance`-style repos still fail with the typed no-`package.json` error — the tarball path just reaches that verdict faster

## Fix 13 GitHub mirror, GUI-PATH pnpm discovery, and slow-network timeouts

- Root cause (field report): the packaged desktop app timed out on GitHub installs while the same machine's terminal `dsh plugin --profile web add github:…` succeeded in ~90 s. Two gaps: the GUI process does not inherit the shell PATH, so the gateway's `pnpm --version` probe failed and it silently took the self-rolled tarball path over a China-grade network; and the self-rolled deadlines (15 s API / 120 s tarball / 30 s ls-remote / 120 s clone) were too short for such networks
- **pnpm discovery** (`pnpm.ts`): `pnpmBinary()` probes `pnpm` on PATH, then absolute fallbacks `/opt/homebrew/bin/pnpm`, `/usr/local/bin/pnpm`, `~/Library/pnpm/pnpm`, `~/.local/share/pnpm/pnpm`; `runPnpm` runs the resolved binary, so the packaged app delegates to the same pnpm the terminal proves works
- **Slow-network deadlines** (`git-source.ts`): API 30 s, tarball 300 s, ls-remote 60 s, clone 300 s — above the observed ~90 s clone while still bounding a permanently stalled transfer
- **GitHub mirror** (`git-source.ts`, `index.ts`): gateway `Config` gains an optional `githubMirror` (http(s) URL prefix; `normalizeGithubMirror` trims, requires http(s), appends `/`, fails loud at load). The prefix is prepended to the codeload and api.github.com URLs only (the clone fallback stays direct git); `packages/bundle/web-app/cordis.patch.yml` wires it as `!!js process.env.DSH_GITHUB_MIRROR`, so the packaged app reads it from the layered `~/.dsh/.env` — e.g. `DSH_GITHUB_MIRROR=https://gh-proxy.com/` (third-party proxies see the content; opt-in, documented as such)
- Verified: host package tests 174 green (pnpm fallback probing, mirror routing/validation, timeout matrix), full host TypeScript aggregate clean; mirror probes against live gh-proxy-family services recorded in the change log

## Fix 14 Browse-plugins UI removal

- Product decision: drop the 浏览插件 section from the plugin list tab — users find plugins on GitHub/npm themselves and paste the package name or repository URL into the install box (the install hint now says so). The section's search box, catalog rows, and source management are gone from `PluginInstallerTab`; the injected `search`/`sources`/`add-source`/`remove-source` callbacks, their protocol parsers, and the browse locale keys leave with it
- The host-side discovery layer stays: `plugin_search`/`plugin_install`/`plugin_uninstall`/`plugin_status` tools and the `search`/`sources`/`add-source`/`remove-source` gateway endpoints remain the search surface (model-facing and programmatic), only the UI is removed
- Verified: `pnpm run test:gui` 289 files / 4014 green; client tests updated in place (browse cases removed, no snapshot goldens carried the section)

## Fix 15 Sole-package promotion, command-paste hint, broader pnpm discovery

- Field follow-ups: a monorepo shell around exactly one package (`whitelonng/dsh-plugin-describe-image`: root has no `package.json`, the sole manifest sits at `packages/vision/tool-describe-image/`) now installs as that package — `promoteSolePackage` walks the downloaded tree (skipping `node_modules`/`.git`), promotes the sole manifest's directory to the root, and fails loud naming the paths when several manifests exist; zero manifests keep the pinned missing-`package.json` error (`dsh-api-balance`-style patch distributors still refuse correctly)
- Pasting a whole shell command into the install box (`dsh plugin --profile web add …`, `pnpm add …`) now rejects with "looks like a shell command — paste only the npm package name or the git repository URL" instead of the generic invalid-spec text
- pnpm discovery widens beyond the static Homebrew paths: `pnpmCandidatePaths` appends `~/.volta/bin/pnpm`, `~/.local/bin/pnpm`, `~/bin/pnpm`, and every node version under `~/.nvm/versions/node/*` and the fnm node-versions directory (newest first) — covers GUI apps whose terminal pnpm lives in a version manager
- Verified: host package tests 178 green (promotion fixtures incl. depth-3 sole package and the multi-manifest error, command-paste matrix, candidate-list probe), full host TypeScript aggregate clean

## Fix 16 Install-time entry-point validation

- Root cause (field report): a git install of `whitelonng/dsh-plugin-describe-image` downloaded fine but crashed the Loader at boot — the repository commits only `src/`, and the package's `main` points at the uncommitted `lib/index.js`. The install recorded success, then the restart failed with `Cannot find module .../lib/index.js`
- `resolvePackageEntry` resolves the declared entry (string `exports`, string `exports["."]`, `main`, default `index.js`); `assertPackageEntry` fails the install loudly when that file is missing from the installed directory, with the remedy: "the repository likely does not commit its build output — build it (pnpm build) and commit the built files, or install the published npm package instead". Wired into all three install surfaces: the self-rolled npm path, the self-rolled git path (after identity validation), and the pnpm-delegated path (after the identity read) — the ecosystem convention is committing `lib/` (`Nagi-ovo/dsh-visualize` does; the failing repository does not)
- Verified: host package tests 182 green (entry-resolution matrix, missing-entry rejection on both npm and git paths, pnpm-delegated fixtures updated to declare and ship an entry), full host TypeScript aggregate clean

## Fix 17 Shebang-aware pnpm spawn, command-paste installs, private single packages

- Root causes (field reports): (1) the packaged app still took the self-rolled path even with `/opt/homebrew/bin/pnpm` present — pnpm's `#!/usr/bin/env node` shebang resolves `node` through the child PATH, which GUI processes lack; the probe now spawns every candidate under an augmented PATH (the candidate directories prepended), and `runPnpm` does the same. (2) `dsh-visualize` was rejected as a workspace root because its manifest is `private: true` — private is a publishing flag, not an installability signal; the identity validation now rejects only declared `workspaces`. (3) pasting the whole `dsh plugin --profile web add …` command failed validation; `normalizeInstallSpec` now extracts the spec from `dsh plugin [--profile X] add`, `pnpm add/i`, and `npm install/i` prefixes before validation
- Verified: host package tests 186 green (augmented-PATH env assertions, command-extraction matrix, private-single-package acceptance, full-command install end to end), full host TypeScript aggregate clean

## Fix 18 Re-install of an already-present pnpm dependency

- Root cause (field report): the panel install of `github:Nagi-ovo/dsh-visualize` failed with "pnpm reported success but no package was added" — the plugin was already installed through the CLI (`@dsh-external/dsh-visualize: github:Nagi-ovo/dsh-visualize` in the profile manifest), so `pnpm add` answered "Already up to date" without adding a key, and the before/after diff was empty
- `installViaPnpm` now falls back when the diff is empty: match the dependency whose recorded value equals the spec (pnpm stores git specs verbatim), or the parsed npm name for npm specs; only when neither resolves does the loud "no package was added" error fire. The pnpm-delegation fixture now stores git specs like real pnpm (resolved name + verbatim spec value)
- Verified: host package tests 189 green (git re-add by spec value, npm re-add by parsed name, no-match rejection, delegation update through the re-add path), full host TypeScript aggregate clean

## Fix 19 Built-in webui trim, conflict auto-disable, archive search and multi-select

- **Webui trim**: the shipped `web-ui` preset product keeps only `pet` + `ui-skin-center` (and the `dsh-client-ui-skin-whale-song` theme dependency); the seven other `@linxin666/*` packages (aionui-panel, task-board, git-graph, remote-web-ui, live-stats, ssh, web-ui-settings) and `@linxin666/dsh-web-ui-all` leave the preset rows and `packages/bundle/web-app` dependencies — the duplicated bottom-left entries vanish from the shipped closure, and suite updates now only touch the skin
- **Conflict auto-disable**: the installer gateway gains `disableControlsOnInstall: [{ id, matches }]`; after a successful install/update whose package name matches, `setControlRowsEnabled` (new `patch.ts` helper sharing the `# dsh-plugin-control:` marker convention) flips the product's rows to `disabled: true`. The web profile wires `[{ id: web-ui, matches: ['dsh-web-ui'] }]` — a user-installed webui suite turns the built-in product off instead of double-mounting
- **Archive search and multi-select**: the archived-sessions section gains a search box (title/session-id filter), per-row checkboxes with a select-all toggle, and a bulk toolbar — 恢复所选 runs immediately, 删除所选 keeps the irreversible-deletion confirmation modal; bulk runs sequentially and refreshes once
- Verified: host package tests 193 green (control-row flip matrix incl. leaving other products and installer rows untouched, conflict-match install end to end, non-match no-op), `test:gui` 289 files / 4037 green, host + client TypeScript aggregates clean

## Fix 20 Dock activation restores a tray-hidden window on macOS

- Root cause: the close-to-tray policy hides the window without destroying it (`close` → `event.preventDefault()` + `window.hide()`), so `mainWindow` still exists afterwards. The macOS `activate` handler returned early on `mainWindow !== undefined`, so a dock click after closing did nothing; the tray click worked because it routes through `showMainWindow()`. An application-level hide (Cmd+H) worked regardless because macOS itself unhides the app on dock activation — which is why the two paths behaved differently
- `apps/desktop/src/main.ts`: the `activate` handler now calls `showMainWindow()`, the shared entry point that restores a hidden window or recreates a closed one against the still-running profile (M1 already listed macOS activate among `showMainWindow()`'s users; the guard contradicted that contract)
- Verified: desktop suite 30/30, `tsc -b apps/desktop` clean, and the packaged `main.js` inspected (activate → showMainWindow)

## Files changed (index)

Per-milestone file tables are in the companion section below; the complete list in this working tree is:

- Desktop shell: `apps/desktop/{src/main.ts, src/lifecycle.ts, src/preload.ts, tsdown.config.ts, electron-builder.yml, scripts/prepare-package.mjs, tests/lifecycle.spec.ts, assets/tray*.png, README*}`
- Web shell: `packages/client/web/{src/app.tsx, src/DesktopTitleBar.tsx, src/DesktopTitleBar.module.css, tests/desktop-title-bar.client.spec.tsx}`
- Archive host: `packages/session/session-persistence/{src/index.ts, src/coordinator.ts, tests/*}`, `packages/session/session-persistence-{jsonl,sqlite}/src/index.ts`, `packages/workspace/workspace/{src/index.ts, tests/workspace.spec.ts}`, `packages/host/apiproxy/{src/api-proxy.ts, src/api/{workspace.ts, workspace.schema.ts, rpc-map.ts, rpc.ts}, src/fetch/{handler.ts, client.ts}, tests/*}`
- Archive client: `packages/client/runtime/src/client/workspaces/*`, `packages/client/runtime/tests/*`, `packages/client/connection/{src/client/fixture.ts, tests/fake-api.client.ts}`, `packages/test-support/client-runtime/src/workspaces.ts`, `packages/client/ui-settings-archive/*`
- Plugin pipeline: `packages/host/plugin-installer/*`, `packages/client/ui-settings-plugin-installer/*`, `packages/bundle/web-app/{cordis.patch.yml, package.json}`
- Merged plugin list: `packages/client/ui-settings-plugin-installer/{src/client/*, tests/*, package.json}`, `packages/host/plugin-inventory/{src/index.ts, src/types.ts, tests/*}` (read-only again), `packages/host/plugin-control/{src/index.ts, src/control-file.ts, tests/*}`, `packages/api/remotes/src/client/index.ts`, `packages/bundle/web-app/{cordis.patch.yml, README*}`, deleted packages `packages/client/ui-settings-plugin-inventory/*` and `packages/client/ui-settings-plugin-control/*`
- Fallback tolerance: `packages/boot/app-boot/{src/profile.ts, tests/profile.spec.ts}`
- Tray click fix: `apps/desktop/{src/main.ts, tests/lifecycle.spec.ts}`
- Dock activation fix: `apps/desktop/src/main.ts`
- Boot recovery: `apps/desktop/src/{boot-marker.ts, recovery.ts}` (+ tests), `apps/desktop/src/main.ts`, `apps/desktop/{package.json, tsconfig.json}`, `apps/cli/src/profile-boot.ts`, `packages/boot/app-boot/src/index.ts` (+ fail-loud report test), `packages/host/plugin-installer/src/boot-failures.ts` (+ tests), `packages/host/plugin-installer/{src/index.ts, tests/gateway.spec.ts, README*}`, `packages/client/ui-settings-plugin-installer/{src/client/*, tests/*, README*}`, `tsconfig.base.json` (installer paths entry)
- Skin patch fix: `patches/@linxin666__dsh-client-ui-skin-center@0.1.2.patch` (regenerated, versioned), `pnpm-workspace.yaml`
- Records and snapshots: the merged-list Agent Note triplet `.agents/notes/implemented/architecture/2026-08-15-merged-plugin-list-tab.*`, refreshed `apps/web/tests/snapshots/plugin-config/section.expected.md` and `apps/web/tests/snapshots/settings-chrome/plugins.expected.md` (removed `plugin-controls.expected.md`), regenerated `docs/module-graph.{md,zh.md}`, `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`, and README updates in plugin-installer / plugin-inventory / plugin-control / web-app
- Reasoning efforts: `packages/client/ui-settings-models/{src/client/reasoning-efforts.ts, ModelListEditor.tsx, DeepSeekModelsEditor.tsx, ModelsSection.module.css, locales.ts, tests/*, README*}`
- Loader fix: `vendor/loader/src/config/tree.ts`, `vendor/README.md`, `packages/boot/app-boot/tests/user-patches.spec.ts`
- Records and snapshots: five Agent Note triplets under `.agents/notes/implemented/architecture/2026-08-14-*`, 11 refreshed `apps/web/tests/snapshots/*` goldens, README updates in workspace/apiproxy/session-persistence
- Machine-side (outside repo): the describe-image bundle inject patch under `~/.dsh/profiles/web/`

## Verification

- Desktop lifecycle 12/12; persistence contract delete round-trip on memory/JSONL/zstd/SQLite; apiproxy 377; workspace 49; plugin-installer host 25 + client 29; plugin-control 11; plugin-inventory 6; app-boot 110 (incl. the same-name-directory tolerance); `test:gui` 283 files / 3853 green
- Host and client TypeScript aggregates clean; translation pairing 952 pairs consistent; changed packages at 100% per-file coverage; the exhaustive coverage run passes 13,582 tests (the single `gen-tool-catalog` failure is the pre-existing `describe_image` drift proven byte-identical on the pristine tree)
- Web e2e replay: 166/167 green — the plugin tab scenario and refreshed goldens pass; the one failure (`background-job-list` settled-row snapshot) is a pre-existing timing race in the jobs list, unrelated to these milestones
- Packaged app inspected: tray click wiring, merged plugin list bundle (only `ui-settings-plugin-installer` remains), plugin-control `insert` writer, installer `status` endpoint, and the fallback tolerance all present (`.artifacts/desktop/release/mac-arm64/DSHCode.app`, 2026-08-15 02:23; DMG + ZIP beside it)
- Boot recovery: `test:gui` 285 files / 3890 green (client 37 + installer host 62 incl. the boot-failures ring, gateway 12, app-boot 84, desktop 29 incl. marker/recovery 18); host and client TypeScript aggregates clean; changed packages at 100% per-file coverage; the exhaustive coverage run passes
- Packaged app inspected: tray click wiring, merged plugin list bundle (only `ui-settings-plugin-installer` remains), plugin-control `insert` writer, installer `status` endpoint, and the fallback tolerance all present (`.artifacts/desktop/release/mac-arm64/DSHCode.app`, 2026-08-15 02:23; DMG + ZIP beside it); the 2026-08-15 10:42 rebuild additionally contains the recovery pipeline — `main.js` carries the boot marker + watchdog + recovery dialog, the installer host lib serves `failures`/`set-safe-mode` and the bounded `boot-failures.json` ring, and the shipped client bundle renders the 启动失败 badge with 让 Agent 修复 / 复制错误
- The 2026-08-15 14:58 rebuild ships the bundle-style installer: the packaged `dsh-host-plugin-installer/lib/index.js` carries `dsh-plugin-bundle` row merging, the git identity diagnostics (`has no package.json at its root`, `multi-package workspace root`), and the transitive dependency tree (`bundlePatchPath`); DMG + ZIP regenerated beside the app

## Known items

- Windows tray/title-bar behavior needs a manual pass on a native Windows build; the recovery dialog likewise (native `showMessageBox` button order and the Windows-safe-mode path)
- A hard crash or main-thread hang leaves no failure record (the boot marker covers those recovery paths); hang attribution is a heuristic over "installed since the last successful boot" — safe mode is the reliable fallback
- Upstream `@linxin666/dsh-tool-describe-image` must add `"locale"` to its client inject list (local profile patch bridges until then)
- Plugin tarball installs have no integrity pinning yet; non-GitHub git sources require the `git` binary (GitHub sources download from codeload without it, subject to the GitHub API's unauthenticated rate limit)
- Permanently deleted sessions leave their shared, content-addressed attachment bytes for a future GC pass
- Profiles that installed plugins before Fix 4 keep legacy bare rows, which never mounted anything; the first toggle in the merged list rewrites them into the `insert` format (no automatic migration, by design — the file is user-owned)
- The `background-job-list` e2e has a known timing race between job settlement and its list-row snapshot (pre-existing; reproducible on the pristine tree)
- Upstream `@linxin666/dsh-client-ui-skin-center` `useSkin` still concatenates a lone `[]` empty document ahead of the managed section; the repository patch normalizes it, but upstream should adopt the same guard
