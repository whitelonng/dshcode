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

## Known items

- Windows tray/title-bar behavior needs a manual pass on a native Windows build
- Upstream `@linxin666/dsh-tool-describe-image` must add `"locale"` to its client inject list (local profile patch bridges until then)
- Plugin tarball installs have no integrity pinning yet; git sources require the `git` binary
- Permanently deleted sessions leave their shared, content-addressed attachment bytes for a future GC pass
- Profiles that installed plugins before Fix 4 keep legacy bare rows, which never mounted anything; the first toggle in the merged list rewrites them into the `insert` format (no automatic migration, by design — the file is user-owned)
- The `background-job-list` e2e has a known timing race between job settlement and its list-row snapshot (pre-existing; reproducible on the pristine tree)
- Upstream `@linxin666/dsh-client-ui-skin-center` `useSkin` still concatenates a lone `[]` empty document ahead of the managed section; the repository patch normalizes it, but upstream should adopt the same guard
