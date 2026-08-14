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
- `desktopLaunchArguments(productName)` → `['--dsh-frame=custom', '--dsh-product-name=<encoded>']`
- `desktopBridgePayload(argv)` → `{ frame: 'custom' | 'native', productName }`
- `desktopIpcSenderIsApplication(senderUrl, origin)` → origin check for IPC handlers
- `buildWindowMenu({ hide, restart, quit })` → `[隐藏到托盘, sep, 重启应用, sep, 退出]`
- Constants: `DESKTOP_SHOW_MENU_CHANNEL = 'desktop:show-menu'`, `DESKTOP_RESTART_CHANNEL = 'desktop:restart'`

**`apps/desktop/src/main.ts`:**

- `installTray()`: builds the tray icon under `mainDir` (`mainDir = fileURLToPath(new URL('.', import.meta.url))` — the ESM main has no `__dirname`); macOS composes an empty `nativeImage` with the 1x/2x colored-logo representations (`tray16.png`/`tray.png`), other platforms load `trayIconFile(platform)`; context menu from `buildTrayMenu`; Windows/Linux wire `tray.on('click') → showMainWindow()`; guarded by try/catch (no tray host → logged, close degrades to real close)
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
- `webPreferences.preload: join(mainDir, 'preload.cjs')`, `additionalArguments: desktopLaunchArguments(PRODUCT_NAME)`

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
- **git path** (`git-source.ts`): `isGitSpec` recognizes `git+`/`git://`/`github:`/repository URLs; `installFromGit(url, dir)` shallow-clones into a staging dir, reads the package identity, moves it to the final location, records the HEAD commit; missing git → typed error
- **State** (`state.ts`): `$DSH_HOME/plugins.json` = `{ plugins: [{ id, name, version, source: { kind: 'npm' | 'git', spec }, installedAt, commit? }] }`; atomic write under a file lock; malformed state fails loud
- **Patch layer** (`patch.ts`): managed row `# dsh-plugin-installer: <id>` comment + `- id: <name>\n  name: <name>` inserted/removed in the profile `cordis.patch.yml`, preserving unowned nodes, comments, and `!!js` expressions
- **Updates**: npm compares `dist-tags.latest` to the installed version; git compares remote HEAD to the recorded commit; offline/vanished sources are skipped per plugin
- Tests (14): state round-trips, spec parsing/semver resolution, patch-row preserve/remove, full gateway flow over a mocked registry (install → list → check-updates → update → uninstall) plus typed rejections

**Client `packages/client/ui-settings-plugin-installer/` (new package):**

- Registers `settings.plugins.tab` id `installer`, order 30, label 安装与更新
- Install box (placeholder npm 包名（如 @scope/name）或 git 仓库 URL), 检查更新 action, one row per plugin (version, 最新 {version} badge, 更新 / 卸载), confirm-gated uninstall Modal, and after any mutation a restart row 插件变更将在重启应用后生效。 + 重启应用 button calling `window.dshDesktop.restart()` (read via a local cast; the authoritative `Window.dshDesktop` type stays in the shell)
- Wire validation in `protocol.ts` (`parsePluginList` / `parseInstalledPlugin` / `parseUpdateList`)
- Tests (12): protocol rejection cases, tab flows, section registration

**Registrations:** `packages/bundle/web-app/cordis.patch.yml` (host + client rows), `web-app/package.json` (deps), `tsconfig.host.json` / `tsconfig.client.json` (references).

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

## Files changed (index)

Per-milestone file tables are in the companion section below; the complete list in this working tree is:

- Desktop shell: `apps/desktop/{src/main.ts, src/lifecycle.ts, src/preload.ts, tsdown.config.ts, electron-builder.yml, scripts/prepare-package.mjs, tests/lifecycle.spec.ts, assets/tray*.png, README*}`
- Web shell: `packages/client/web/{src/app.tsx, src/DesktopTitleBar.tsx, src/DesktopTitleBar.module.css, tests/desktop-title-bar.client.spec.tsx}`
- Archive host: `packages/session/session-persistence/{src/index.ts, src/coordinator.ts, tests/*}`, `packages/session/session-persistence-{jsonl,sqlite}/src/index.ts`, `packages/workspace/workspace/{src/index.ts, tests/workspace.spec.ts}`, `packages/host/apiproxy/{src/api-proxy.ts, src/api/{workspace.ts, workspace.schema.ts, rpc-map.ts, rpc.ts}, src/fetch/{handler.ts, client.ts}, tests/*}`
- Archive client: `packages/client/runtime/src/client/workspaces/*`, `packages/client/runtime/tests/*`, `packages/client/connection/{src/client/fixture.ts, tests/fake-api.client.ts}`, `packages/test-support/client-runtime/src/workspaces.ts`, `packages/client/ui-settings-archive/*`
- Plugin pipeline: `packages/host/plugin-installer/*`, `packages/client/ui-settings-plugin-installer/*`, `packages/bundle/web-app/{cordis.patch.yml, package.json}`
- Reasoning efforts: `packages/client/ui-settings-models/{src/client/reasoning-efforts.ts, ModelListEditor.tsx, DeepSeekModelsEditor.tsx, ModelsSection.module.css, locales.ts, tests/*, README*}`
- Loader fix: `vendor/loader/src/config/tree.ts`, `vendor/README.md`, `packages/boot/app-boot/tests/user-patches.spec.ts`
- Records and snapshots: five Agent Note triplets under `.agents/notes/implemented/architecture/2026-08-14-*`, 11 refreshed `apps/web/tests/snapshots/*` goldens, README updates in workspace/apiproxy/session-persistence
- Machine-side (outside repo): the describe-image bundle inject patch under `~/.dsh/profiles/web/`

## Verification

- Desktop lifecycle 12/12; persistence contract delete round-trip on memory/JSONL/zstd/SQLite; apiproxy 377; workspace 49; plugin-installer host 14 + client 12; ui-settings-models 226; `test:gui` 3841 green; app-boot (incl. loader-fallback regression) 107
- Host and client TypeScript aggregates clean; translation pairing 952 pairs consistent; desktop runtime closure 202 packages
- Web e2e replay: settings-scenario goldens re-recorded and green; the 31 full-suite failures on this machine were proven byte-identical against the pristine tree (pre-existing environment issues)
- Packaged app inspected: tray code + icons, archive/installer/reasoning bundles, preload, loader fallback all present (`.artifacts/desktop/release/mac-arm64/DSHCode.app`, 2026-08-14 20:39)

## Known items

- Windows tray/title-bar behavior needs a manual pass on a native Windows build
- Upstream `@linxin666/dsh-tool-describe-image` must add `"locale"` to its client inject list (local profile patch bridges until then)
- Plugin tarball installs have no integrity pinning yet; git sources require the `git` binary
- Permanently deleted sessions leave their shared, content-addressed attachment bytes for a future GC pass
