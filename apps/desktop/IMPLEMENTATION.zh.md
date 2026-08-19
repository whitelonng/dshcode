[English](IMPLEMENTATION.md) | 中文

# DSHCode 桌面端：实施方案与开发内容

> 一份汇总本仓库桌面产品工作的文档：每个里程碑的设计、**实际实现的内容**（接口、线协议载荷、数据结构、UI 文案）、改动的文件与验证方式。各决策理由记录在 Agent Notes（[.agents/notes/implemented/architecture](../../.agents/notes/implemented/architecture/)）。

## M1 系统托盘、关闭隐藏、移除默认菜单

### 设计

主进程持有唯一 `Tray`；关闭窗口默认隐藏到托盘，除非真实退出持有拆除；Windows/Linux 不再显示默认 Electron 菜单栏。

### 实现内容

**`apps/desktop/src/lifecycle.ts`（纯函数，已单测）：**

- `windowCloseDisposition(quitArmed: boolean): 'hide' | 'close'`
- `buildTrayMenu({ show, quit })` → `[显示主界面, 分隔线, 退出]`（产品文案中文）
- `trayIconFile(platform)` → darwin 用 `trayTemplate.png`，其余用 `tray.png`
- `desktopLaunchArguments(productName, appVersion)` → `['--dsh-product-name=<编码>', '--dsh-app-version=<编码>']`（所有平台都传；仅 Windows 由调用方额外追加 `--dsh-frame=custom`）
- `desktopBridgePayload(argv)` → `{ frame: 'custom' | 'native', productName, appVersion }`
- `desktopIpcSenderIsApplication(senderUrl, origin)` → IPC 发送方源校验
- `buildWindowMenu({ hide, restart, quit })` → `[隐藏到托盘, 分隔线, 重启应用, 分隔线, 退出]`
- 常量：`DESKTOP_SHOW_MENU_CHANNEL = 'desktop:show-menu'`、`DESKTOP_RESTART_CHANNEL = 'desktop:restart'`

**`apps/desktop/src/main.ts`：**

- `installTray()`：从 `join(__dirname, '..', 'assets', trayIconFile(platform))` 创建 `Tray`；macOS 调 `setTemplateImage(true)`；右键菜单来自 `buildTrayMenu`；Windows/Linux 绑定 `tray.on('click') → showMainWindow()`；try/catch 防护（无托盘宿主时记日志，关闭策略降级为真实关闭）
- `showMainWindow()`：最小化则恢复，隐藏则显示并聚焦，已销毁则按 `applicationUrl` 重建（托盘、单实例锁、macOS activate 共用）
- 关闭策略：`window.on('close', e => { if (tray !== undefined && windowCloseDisposition(quitArmed) === 'hide') { e.preventDefault(); window.hide() } })`
- `quitArmed = true` 由托盘「退出」、窗口菜单「重启应用/退出」与 `before-quit` 置位（后者仍走 `requestQuit → Harness 关闭 → app.exit`）
- 仅 win32/linux 执行 `Menu.setApplicationMenu(null)`（macOS 保留系统菜单栏）

**资源：** `assets/tray.png`（32 px 彩色）、`assets/trayTemplate.png`（16 px）+ `assets/trayTemplate@2x.png`（32 px 黑色单色，macOS 模板图），由 `icon.svg` 经 rsvg-convert 生成。

**打包：** `electron-builder.yml` 分发 `assets/**`；`scripts/prepare-package.mjs` 把 `assets/` 拷入打包应用。

**测试：** `apps/desktop/tests/lifecycle.spec.ts` —— 12 用例（关闭处置、托盘/窗口菜单标签与回调、图标选择、桥负载往返、发送方校验）。

## M2 Windows 单行标题栏

### 设计

Windows 经隐藏式标题栏 + `titleBarOverlay` 把产品名、菜单按钮与原生窗口控制按钮放进同一行；渲染进程经沙箱 preload 桥访问窗口菜单。

### 实现内容

**窗口选项（main.ts，仅 Windows）：**

- `titleBarStyle: 'hidden'`，`titleBarOverlay: { color: '#ffffff', symbolColor: '#0f1115', height: 38 }`
- `webPreferences.preload: join(__dirname, 'preload.cjs')`，`additionalArguments: desktopLaunchArguments(PRODUCT_NAME, app.getVersion())`，仅 Windows 自定义边框额外追加 `--dsh-frame=custom`（渲染层版本角标在所有平台读取应用版本；只有 Windows 绘制自己的标题栏行）

**`apps/desktop/src/preload.ts`（沙箱 CommonJS；沙箱 preload 无法加载 ESM）：**

- `contextBridge.exposeInMainWorld('dshDesktop', { ...desktopBridgePayload(process.argv, process.platform), showMenu: () => ipcRenderer.invoke('desktop:show-menu'), restart: () => ipcRenderer.invoke('desktop:restart') })`

**IPC（main.ts，profile 启动后注册）：**

- `desktop:show-menu` —— 经 `desktopIpcSenderIsApplication` 校验发送方后 `Menu.buildFromTemplate(buildWindowMenu({hide, restart, quit})).popup({ window })`
- `desktop:restart` —— 同样校验后 `quitArmed = true; app.relaunch(); requestQuit(0)`（relaunch 在关闭前排队，拆除如何落定进程都会重启）

**Web 壳 `packages/client/web/src/DesktopTitleBar.tsx`（+ `.module.css`）：**

- `window.dshDesktop` 缺失或 `frame !== 'custom'` 时原样渲染子节点（浏览器/macOS 输出不变）
- 自定义框架：绝对定位 38 px 可拖拽条（`-webkit-app-region: drag`），内容为产品名 + 汉堡菜单按钮（`no-drag`，aria-label 应用菜单），body 内边距 39px；内容宽度用 `env(titlebar-area-width, 100%)` 避开原生 overlay 按钮
- 壳组装 `app.tsx`：`<DesktopTitleBar>{ctx.slots.renderSlot('root', {})}</DesktopTitleBar>`

**构建：** `tsdown.config.ts` 双入口双格式 + `outExtension` 映射 —— `lib/main.js`（ESM，不变）与 `lib/preload.cjs`（CJS，preload 目标）；两个惰性兄弟产物为设计使然。

**测试：** `packages/client/web/tests/desktop-title-bar.client.spec.tsx` —— 无桥直通、原生框架直通、自定义框架渲染名字并触发 `showMenu`。

## M3 归档会话管理

### 设计

归档可管理：持久化层持久删除、注册表恢复/移除、三个 workspace RPC 与设置页（恢复 + 需确认的彻底删除）。

### 实现内容

**持久化（宿主）：**

- `SessionPersistence.delete(id: SessionId): Promise<void>`（抽象，新公开方法）
- `PersistenceBackend.deleteStored?(id, signal?): Promise<boolean>`（可选钩子，同 `loadStoredFrom`）
- `PersistenceCoordinator.delete(id)`：丢弃内存状态、使已准备读取失效、后端缺钩子时明确报错
- JSONL 后端：经既有 id 扫描解析日志路径，删除会话专属目录
- SQLite 后端：单事务 `DELETE FROM events WHERE session_id = ?; DELETE FROM sessions WHERE id = ?`；无行返回 false
- 共享契约测试 `packages/session/session-persistence/tests/contract.ts` 在 memory/JSONL/zstd/SQLite 上运行

**workspace 注册表（宿主）：**

- `restoreSession(sessionId)`：从 `archivedSessionIds` 移除（幂等；账目槽位保留）
- `removeSession(sessionId)`：从每个所属 workspace 分离该 id + 从归档集合移除（未知 id no-op）

**线协议（apiproxy）：**

- `workspace.restoreSession { sessionId }` → `{ archivedSessionIds }`
- `workspace.deleteSession { sessionId }` → `{ archivedSessionIds }`；拒绝 `not-archived`（不在归档集合）与 `session-active`（活跃会话）；先删日志，后清账目
- `workspace.listArchived {}` → `{ items: [{ sessionId, title?, createdAt? }] }`（标题经 `sessionQuery.readTitleSnapshots` 折叠，时间取持久化头部；sessionQuery 缺失时优雅降级）
- `api/rpc.ts` 新错误码：`'not-archived'` 与 `'session-active'`（均携带 `{ sessionId }`）
- `deleteSession` 刻意不进 agent 工具目录（破坏性，仅产品表面）

**客户端运行时：** `workspaces` manager/service/contract 增加 `restoreSession(sessionId)` 与 `deleteSession(sessionId)`，经既有 `installArchived` 投影安装返回的归档集合。

**设置页 `packages/client/ui-settings-archive/`（新包）：**

- 注册 `settings.section` id `archive`、order 30、标签「归档会话」
- 每个归档会话一行：折叠标题（回退「未命名会话」）、id、「创建于 {time}」；操作「恢复」与「彻底删除」（危险按钮 + Modal：标题「彻底删除会话」，正文「删除后会话日志将永久移除，无法恢复。附件文件可能仍占用存储空间。」，动作「取消 / 确认删除」）
- 线面：`connection.rpc.call('/api', 'workspace.listArchived' | 'workspace.restoreSession' | 'workspace.deleteSession', …)`，响应在 `protocol.ts` 校验
- 空态「没有归档的对话。删除工作区中的会话会先归档到这里。」

**快照：** 11 个 golden 刷新——设置导航新增「归档会话」行（已核对差异仅此新增）。

## M4 应用内重启通道

- IPC `desktop:restart`（源校验）：`quitArmed = true; app.relaunch(); requestQuit(0)` —— 打包版 Electron 无法热应用的 profile/patch 变更的生效通道
- 经 preload 桥（`window.dshDesktop.restart()`）与标题栏菜单「重启应用」暴露

## M5 插件安装与更新管道

### 设计

仅回环网关持有用户插件安装（npm spec 或 git URL → 共享模块 fallback），带持久状态、patch 层行与更新检测；新设置标签页驱动，并以重启入口收尾。

### 实现内容

**宿主 `packages/host/plugin-installer/`（新包）：**

- 网关通道 `/plugin-installer`（`authority: 'loopback'`），端点 `list` / `install { spec }` / `update { id }` / `uninstall { id }` / `check-updates`；未知端点 → `bad-request`；zod 校验载荷；变更按实例串行
- 配置：`{ profilePatchPath, dshHome?, registry? }`（registry 默认 `npm_config_registry`，其次 `https://registry.npmjs.org/`）
- **npm 路径**（`registry.ts`）：`fetchPackument(name, registry)`（scope 包编码为 `@scope%2Fname`）、`resolveNpmVersion(spec, packument)`（精确 → semver 范围 `maxSatisfying`，排除预发布 → `dist-tags.latest`）、`installNpmPackage(...)` 下载 tarball 并以 `tar.x({ cwd, strip: 1 })` 解压到 `$DSH_HOME/profiles/node_modules/<name>`
- **git 路径**（`git-source.ts`）：`isGitSpec` 识别 `git+`/`git://`/`github:`/仓库 URL（含 `#ref` 固定引用）；GitHub 仓库经 codeload 源码 tarball 安装、经 GitHub API 解析 commit——无需 `git` 二进制、CDN 速度下载、`GITHUB_TOKEN`/`GH_TOKEN` 可解除 60 次/小时的 API 限流——其他托管浅克隆（GitHub URL 在 tarball 路径失败且本机有 git 时也回退到克隆）；`installFromGit(url, dir)` 暂存到临时目录、读取包身份、移到最终位置并记录 HEAD commit；缺 git → 类型化错误
- **状态**（`state.ts`）：`$DSH_HOME/plugins.json` = `{ plugins: [{ id, name, version, source: { kind: 'npm' | 'git', spec }, installedAt, commit? }] }`；文件锁内原子写；畸形状态失败即报错
- **Patch 层**（`patch.ts`）：受管行 `# dsh-plugin-installer: <id>` 注释 + `- id: <name>\n  name: <name>` 在 profile `cordis.patch.yml` 中插入/移除，保留非属主节点、注释与 `!!js` 表达式
- **更新检测**：npm 比较 `dist-tags.latest` 与已装版本；git 比较远端 HEAD 与记录 commit；来源离线/消失按插件跳过
- 测试（14）：状态往返、spec 解析/semver、patch 行保留与移除、mock registry 上的完整网关流程（安装 → 列表 → 检查更新 → 更新 → 卸载）与类型化拒绝

**客户端 `packages/client/ui-settings-plugin-installer/`（新包）：**

- 注册 `settings.plugins.tab` id `installer`、order 30、标签「安装与更新」
- 安装框（占位符「npm 包名（如 @scope/name）或 git 仓库 URL」）、「检查更新」动作、每插件一行（版本、「最新 {version}」徽标、「更新 / 卸载」）、需确认的卸载 Modal；任何变更后出现重启行「插件变更将在重启应用后生效。」+「重启应用」按钮调用 `window.dshDesktop.restart()`（经局部断言读取；权威 `Window.dshDesktop` 类型保留在壳中）
- `protocol.ts` 线协议校验（`parsePluginList` / `parseInstalledPlugin` / `parseUpdateList`）
- 测试（12）：协议拒绝用例、标签页流程、section 注册

**注册：** `packages/bundle/web-app/cordis.patch.yml`（host + client 行）、`web-app/package.json`（依赖）、`tsconfig.host.json` / `tsconfig.client.json`（引用）。

## 修复 1 第三方模型推理等级

### 实现内容（`packages/client/ui-settings-models`）

- `src/client/reasoning-efforts.ts`（新）：`THINKING_LEVELS = ['off','minimal','low','medium','high','xhigh','max']`；`parseReasoningEfforts(text)` 接受 `high: high, max: ultra`（逗号分隔 `等级: 拼写`；`off` 可单独出现或带空拼写），空文本 = 不声明；`formatReasoningEfforts(value)` 反向；`INVALID_EFFORTS = 'invalid'` 哨兵；`validReasoningEfforts(value)` 拒绝未知等级与空非 off 拼写
- `ModelListEditor.tsx`：展开区新增「推理等级」文本输入（每行 buffer，同容量字段）与「禁用推理」复选框（`false`）；不可读文本在草稿中停靠哨兵
- `DeepSeekModelsEditor.tsx`：`validateDeepSeekModels` 对哨兵或非法 record 返回 `{ index, key: 'modelReasoningEffortsInvalid' }` —— 写入前拒绝
- 值原样落入 `providers.<route>.models[].reasoningEfforts`，经既有 `settings.mutate` 整值替换数组路径（pi-ai 适配器已消费；选择器随即提供声明的等级）
- 文案（zh）：推理等级 / 例如 high: high, max: ultra / 禁用推理 / 推理等级需为「等级: 拼写」对，逗号分隔，例如 high: high, max: ultra；off 可留空。
- 测试：`tests/reasoning-efforts.client.spec.ts`（解析/格式化/校验）+ 编辑器行为用例（草稿收到解析值、哨兵被拒、复选框往返）

## 修复 2 describe-image 客户端 locale 注入

- 根因：已发布的 `@linxin666/dsh-tool-describe-image` 0.1.12 client bundle 的 `const inject = ["slots","conversation","sessions"]`，但 `apply()` 第一行执行 `ctx.locale.register(NS, dictionaries)` → `cannot get property "locale" without inject`
- 仓库侧无需改动（上游修复 = inject 列表补 `"locale"`）
- 本机侧已实施：`~/.dsh/profiles/web/node_modules/@linxin666/dsh-tool-describe-image/lib/client.js` 修补为 `["slots","conversation","sessions","locale"]`；bundle 内所有 `ctx.*` 访问均已对照 inject 核对

## 修复 3 打包宿主插件解析

- 根因：打包版 Electron 拿不到 Node loader 内部模块 → `ModuleLoader.fromInternal()` 返回 undefined → `EntryTree.import` 回退到裸动态导入，从 loader 模块自身位置（App 的 `node_modules`）解析，profile 层插件（home patch 行）无法加载
- `vendor/loader/src/config/tree.ts`：新分支——`ctx.baseUrl` 为 `file://` URL 时，`const { createRequire } = await import('node:module')`、`const { pathToFileURL } = await import('node:url')`、`createRequire(ctx.baseUrl).resolve(name)`，再导入解析出的 `file://` URL。动态导入保持浏览器 bundle 干净（浏览器注入自己的 `internal`，不会进入该分支）
- 登记为 vendor 本地修改 **#19**（`vendor/README.md`）
- 回归测试 `packages/boot/app-boot/tests/user-patches.spec.ts`：强制 `ctx.loader.internal = undefined` 并从配置树 `node_modules` 加载夹具包

## 修复 4 Dock 图标激活恢复隐藏到托盘的窗口（macOS）

- 根因：关闭到托盘策略只隐藏窗口不销毁（`close` → `event.preventDefault()` + `window.hide()`），`mainWindow` 引用仍然存在。macOS 的 `activate` 处理器在 `mainWindow !== undefined` 时提前返回，于是点叉关闭后点 Dock 图标没有任何反应；托盘点击之所以有效，是因为它走 `showMainWindow()`。应用级隐藏（Cmd+H）一直有效，是因为 macOS 在 Dock 激活时会自动还原整个应用——两条路径因此表现不一致
- `apps/desktop/src/main.ts`：`activate` 处理器改为调用 `showMainWindow()`——恢复隐藏窗口、或在窗口已销毁时基于仍在运行的 profile 重建（M1 的 `showMainWindow()` 契约本就包含 macOS activate；原守卫与契约相悖）
- 验证：桌面套件 30/30、`tsc -b apps/desktop` 干净、打包后的 `main.js` 检查通过（activate → showMainWindow）

## 改动文件索引

- 桌面壳：`apps/desktop/{src/main.ts, src/lifecycle.ts, src/preload.ts, tsdown.config.ts, electron-builder.yml, scripts/prepare-package.mjs, tests/lifecycle.spec.ts, assets/tray*.png, README*}`
- Dock 激活修复：`apps/desktop/src/main.ts`
- Web 壳：`packages/client/web/{src/app.tsx, src/DesktopTitleBar.tsx, src/DesktopTitleBar.module.css, tests/desktop-title-bar.client.spec.tsx}`
- 归档宿主：`packages/session/session-persistence/{src/index.ts, src/coordinator.ts, tests/*}`、`packages/session/session-persistence-{jsonl,sqlite}/src/index.ts`、`packages/workspace/workspace/{src/index.ts, tests/workspace.spec.ts}`、`packages/host/apiproxy/{src/api-proxy.ts, src/api/{workspace.ts, workspace.schema.ts, rpc-map.ts, rpc.ts}, src/fetch/{handler.ts, client.ts}, tests/*}`
- 归档客户端：`packages/client/runtime/src/client/workspaces/*`、`packages/client/runtime/tests/*`、`packages/client/connection/{src/client/fixture.ts, tests/fake-api.client.ts}`、`packages/test-support/client-runtime/src/workspaces.ts`、`packages/client/ui-settings-archive/*`
- 插件管道：`packages/host/plugin-installer/*`、`packages/client/ui-settings-plugin-installer/*`、`packages/bundle/web-app/{cordis.patch.yml, package.json}`
- 推理等级：`packages/client/ui-settings-models/{src/client/reasoning-efforts.ts, ModelListEditor.tsx, DeepSeekModelsEditor.tsx, ModelsSection.module.css, locales.ts, tests/*, README*}`
- Loader 修复：`vendor/loader/src/config/tree.ts`、`vendor/README.md`、`packages/boot/app-boot/tests/user-patches.spec.ts`
- 记录与快照：`.agents/notes/implemented/architecture/2026-08-14-*` 五篇 Agent Note 三件套、11 个刷新后的 `apps/web/tests/snapshots/*` golden、workspace/apiproxy/session-persistence 的 README 更新
- 本机（仓库外）：`~/.dsh/profiles/web/` 下 describe-image bundle 的 inject 修补

## 验证

- 桌面生命周期 12/12；持久化契约删除往返（memory/JSONL/zstd/SQLite）；apiproxy 377；workspace 49；plugin-installer 宿主 14 + 客户端 12；ui-settings-models 226；`test:gui` 3841 全绿；app-boot（含 loader 回退回归）107
- Host 与 client TypeScript 聚合干净；翻译配对 952 对一致；桌面运行时闭包 202 包
- Web e2e 回放：设置场景 golden 重录且全绿；本机全量套件 31 个失败已与纯净树逐项比对一致（环境既有问题）
- 打包应用经检查验证：托盘代码 + 图标、归档/安装器/推理等级 bundle、preload、loader 回退分支均在（`.artifacts/desktop/release/mac-arm64/DSHCode.app`，2026-08-14 20:39 构建）

## 已知事项

- Windows 托盘/标题栏行为需在原生 Windows 构建上人工核对
- 上游 `@linxin666/dsh-tool-describe-image` 需在其 client inject 列表补 `"locale"`（此前以 profile 层本地修补维持）
- 插件 tarball 安装尚无完整性固定；非 GitHub 的 git 来源需要本机 `git` 二进制（GitHub 来源经 codeload 下载、无需 git，但受未认证 GitHub API 速率限制）
- 彻底删除的会话其（content-addressed、共享的）附件字节留待未来的 GC 通道
