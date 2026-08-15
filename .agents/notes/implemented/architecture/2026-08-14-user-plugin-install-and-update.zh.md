# Agent Note: 用户插件安装与更新管道

Status: implemented

[English](2026-08-14-user-plugin-install-and-update.md) | 中文

> 范围：仅回环 plugin-installer 网关（宿主）、安装/更新标签页（客户端），以及它们消费的重启应用通道。与 [plugin-control](2026-08-14-built-in-community-plugins-and-controls.md)（配置产品的开关）互补，支持开放式用户安装；消费 [桌面重启通道](2026-08-14-desktop-single-row-title-bar.md)。

## 问题

插件管理是封闭的：`plugin-control` 只切换部署配置的产品，社区插件家族（`dsh-web-ui-all`）靠手工装进共享模块 fallback。用户无法从 npm spec 或仓库 URL 安装插件，没有安装记录与来源记录，也没有更新检测——这正是桌面产品继承自 WebUI 的缺口。

## 决策

### 宿主：一个仅回环网关持有用户插件安装

`@deepseek-ai/dsh-host-plugin-installer` 把 `/plugin-installer` 注册在 Connection 通道上（`authority: 'loopback'`），由组合 profile 配置（`profilePatchPath`，可选 `dshHome` 与 `registry`）。端点：`list`、`install { spec }`、`update { id }`、`uninstall { id }`、`check-updates`。

- **来源。** npm spec（`name`、`name@version`、`name@range`）按 registry packument 解析（默认 `npm_config_registry`，其次 npmjs），用 semver 范围选择（精确 → 范围 → `dist-tags.latest`，范围解析排除预发布版本）；tarball 经 HTTPS 下载并用 `tar` 解压到扁平模块 fallback `$DSH_HOME/profiles/node_modules/<name>`（带 scope 的名字保留 `@scope/` 目录）。GitHub URL（`github:owner/repo`、`https://github.com/owner/repo`，可带 `#ref` 固定引用）从 codeload 下载源码 tarball、经 GitHub API 解析 commit——无需 `git` 二进制；其他 git 托管（git+、git://、https 仓库路径）用 `git` 二进制浅克隆，GitHub URL 在 tarball 路径失败且本机有 git 时回退到克隆。包在临时目录暂存，读取并校验身份后移动到最终 fallback 位置。
- **状态。** `$DSH_HOME/plugins.json` 记录每次安装：id（包名）、显示名、版本、来源类型/spec、安装时间，以及仓库来源的 git commit。写入在文件锁内原子完成；畸形状态失败即报错。
- **Patch 层。** 每次安装/更新都会向 profile 用户 patch 层插入受管 loader 行（`id` + `name` = 包名，带 `dsh-plugin-installer:` 注释标记），通过保留非属主节点、注释与 `!!js` 表达式的 YAML 文档操作完成；卸载时移除。
- **更新。** `check-updates` 逐插件比较 npm `dist-tags.latest`（git 来源为远端 HEAD）与已安装版本；来源离线或消失时按插件静默降级。
- **生效。** 运行中的树不被触碰：打包版 Electron 无法热应用宿主插件，因此安装/更新/卸载在重启后生效。客户端标签页以重启入口收尾（桌面：preload `restart()` → `app.relaunch`；浏览器：提示文本）。

### 客户端：安装与更新标签页

`@deepseek-ai/dsh-client-ui-settings-plugin-installer` 注册 `settings.plugins.tab` 条目 `installer`（顺序 30）：安装输入框（npm spec 或 git URL）、每个已装插件一行（版本、更新徽标、更新/卸载操作）、检查更新动作与内联失败文案。卸载需要显式确认弹窗。线面调用网关通道并在 `protocol.ts` 校验响应。桌面桥经局部断言读取——权威的 `Window.dshDesktop` 类型保留在壳中（第二个全局声明会在声明合并下静默替换它）。

## 验证

宿主套件覆盖：状态往返与畸形状态失败即报错、spec 解析与 semver 解析、保留非属主 YAML 的 patch 行插入/移除，以及基于 mock registry 的完整网关流程（安装 → 列表 → 检查更新 → 更新 → 卸载，含按版本 tarball）与类型化拒绝。客户端套件覆盖协议校验、标签页流程（列表、安装、更新、确认卸载、重启动作、空态）与 section 注册。web 回放套件在新标签行之后重新验证设置对话框。

## 备选方案

**为 tarball 安装增加完整性固定（npm `integrity`）。** 已拒绝：registry packument 携带该字段，但校验需要额外的哈希管道；HTTPS 加用户拥有的代码执行决策覆盖 v1，记录为已知限制。

**通过 spawn npm CLI 安装。** 已拒绝：打包版 Electron 不携带 npm；registry HTTP + `tar` 路径自包含，git 仅在非 GitHub 仓库来源时作为显式机器要求（GitHub 来源经 codeload 下载、无需 git）。

**用客户端 HMR 通道应用插件变更而非重启。** 已拒绝：新安装要新增 Loader 行，需要打包版 Electron 中被禁用的宿主配置热重载；重启通道已存在，且对打包约束诚实。

## 影响

- 用户可完全从设置中安装、更新、卸载 npm 或 git 来源的插件；安装状态与来源持久化在 `$DSH_HOME/plugins.json`。
- 新插件在应用重启后生效（桌面：经桥一键重启；浏览器：重启 `dsh web` 进程）。
- 非 GitHub 的仓库来源需要机器上有 `git`（GitHub 来源经 codeload 下载、无需 git，但受未认证 GitHub API 速率限制）；npm 安装尚无完整性固定——两者都记录为已知限制。
- 设置对话框新增一个标签页（安装与更新），由回放的 web 套件覆盖。

## 相关

- [桌面端插件启动失败恢复](../../implemented/architecture/2026-08-15-desktop-plugin-boot-recovery.md) 复用本网关的受管 patch 行与状态辅助函数实现禁用并重启的恢复流程，并为网关新增 `failures`/`set-safe-mode` 端点。
- [GitHub 插件安装改走 codeload tarball 与 GitHub API](../../implemented/architecture/2026-08-15-github-tarball-installs.md) 为 GitHub 来源替换浅克隆；本笔记的身份校验与 commit 记录正是该路径仍执行的部分。
