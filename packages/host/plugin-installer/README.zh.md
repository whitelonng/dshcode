---
description: "当前 profile 的仅回环插件安装与更新：/plugin-installer 网关从 npm 或 git 安装、检查更新、镜像启用状态、记录启动失败，并暴露四个面向模型的插件工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-installer

[English](README.md) | 中文

## 概述

当前 profile 的仅回环插件安装与更新。网关（`/plugin-installer`）以 `authority: 'loopback'` 注册在 Connection 通道上，暴露 list、install、update、uninstall、set-enabled、check-updates、failures 与 set-safe-mode。它从 npm spec 或 git 仓库 URL 安装，把每个插件记录到 `$DSH_HOME/plugins.json`，并把受管 `insert` patch 行合并进 profile 用户 patch 层，插件在重启后加载。它还注册四个面向模型的工具（`plugin_search`、`plugin_install`、`plugin_uninstall`、`plugin_status`），与浏览器面板读写同一份安装态。所有变更串行化；状态文件在锁内原子写入，patch 层编辑保留每个非属主 YAML 节点。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本包组合进挂载 Connection 通道的宿主组合；网关只应答具有回环权限的请求。它暴露：

- `list` —— 从 `$DSH_HOME/plugins.json` 读取已安装快照，每行附带从受管 patch 行读出的已保存启用状态。
- `install { spec }` —— 从 npm spec（`name`、`name@version`、`name@range`）或 git 仓库 URL 安装，然后把插件记录下来并向 profile 用户 patch 层插入受管 `insert` patch 项；插件在应用重启后加载。
- `status` —— 浏览器在修改进行中轮询的当前安装/更新进度（`idle`，或 `fetch`/`download`/`extract`/`write` 并带可选的下载百分比）。
- `update { id }` —— 从记录的来源重新安装一个插件并刷新行。
- `uninstall { id }` —— 删除安装目录、受管 patch 行与状态条目。
- `set-enabled { id, enabled }` —— 通过重写受管 patch 行（写入 `disabled` 标记）持久化插件下次启动的启用状态；重启前运行中的 Loader 不受影响。
- `check-updates` —— 把 npm `dist-tags.latest`（git 来源则为远端 HEAD）与已安装版本比较，不做任何变更；离线或已消失的来源按插件跳过。
- `failures` —— 已记录的启动失败（`$DSH_HOME/boot-failures.json`，有界的按插件环形记录）、插件安装根目录（`$DSH_HOME/profiles`），以及桌面端是否处于安全模式。
- `set-safe-mode { enabled }` —— 创建或删除安全模式标记文件（`$DSH_HOME/safe-mode`）；桌面端启动时读取它来决定跳过用户 patch 层；与重启动作一起切换。

卸载插件时同时清除它的启动失败记录。

### 何时选择它

当部署必须让操作者安装、更新或移除 profile 的用户添加插件，并让 Agent 修复一个失败的插件时选择本包。若插件在带外管理、从不由用户安装，则不必使用本包；固定部署清单由 [`plugin-control`](../../../packages/host/plugin-control/README.zh.md) 网关负责。

### 最小配置

网关挂载在 Connection 通道上，`authority: 'loopback'`；pnpm 可用性自动探测，可选的 `githubMirror` 配置为受限网络把镜像前缀加到 codeload 与 api.github.com URL 前面。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

npm 包按配置的 registry（默认 `npm_config_registry`，其次 npmjs）解析，下载 tarball 并按 registry 的 `dist.integrity` SRI 声明校验（有声明时；不匹配与不支持的算法集会大声失败，锁定的完整性记入 `plugins.json`），解压到扁平模块 fallback `$DSH_HOME/profiles/node_modules/<name>`。GitHub 仓库（`github:user/repo` 简写或 `https://github.com/user/repo`，可带 `#ref` 后缀固定分支、标签或 commit）从 codeload 下载源码 tarball、经 GitHub API 解析 commit——不需要 `git` 二进制，CDN 下载也不会像克隆那样卡住，设置 `GITHUB_TOKEN`/`GH_TOKEN` 可解除未认证 API 的速率限制。其他 git 托管做浅克隆（需要 `git` 二进制）；GitHub URL 在 tarball 路径失败且本机有 git 时回退到同样的浅克隆（codeload 返回 404 即终局）。克隆后先校验检出身份再写任何内容——根目录没有 `package.json` 的仓库、多包 workspace 根或非法包名都会以带 URL 的类型化错误失败。包声明的入口文件必须存在于安装目录——没有提交构建产物的仓库会在安装时就失败，而不是等到重启时把 Loader 弄崩。只包一个包的 monorepo 壳按那个包安装。bundle 风格包（声明 `dsh.bundle.patch`）还会把它的传递 npm `dependencies` 装进 fallback，并把 bundle 的 patch 行合并进 profile 用户 patch 层，每行带 `# dsh-plugin-bundle: <id>` 标记。

registry 与 GitHub 请求带硬超时，按慢速、被限流的网络来定（npm 元数据 30 秒、npm tarball 60 秒、GitHub API 30 秒、GitHub tarball 300 秒），网络停滞会以错误呈现，而不是让界面停留在永久的“安装中”状态。所有变更串行化；状态文件在锁内原子写入，patch 层编辑保留每个非属主 YAML 节点、注释与 `!!js` 表达式。

pnpm 可用时，网关把安装/更新/卸载委托给 profile workspace 里的 `pnpm add`/`remove`；探测先查 PATH 上的 `pnpm`，再试静态绝对路径，最后逐个试 nvm 与 fnm 版本目录下的 pnpm。可选的 `githubMirror` 配置（http(s) URL 前缀，加载时校验）只加在 codeload 与 api.github.com URL 前面，服务受限网络；web profile 把分层 `.env` 里的 `DSH_GITHUB_MIRROR` 传给它。`disableControlsOnInstall` 规则（`[{ id, matches }]`）在安装/更新后的包名命中任一 `matches` 子串时，禁用指定 plugin-control 产品的 patch 行。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [宿主 plugin-control 网关](../../../packages/host/plugin-control/README.zh.md)
- [Web 插件设置标签页](../../../packages/client/ui-settings-plugin-installer/README.zh.md)
- [Settings seam](../../../packages/settings/settings/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### Agent 工具

#### 模型看到的内容

网关注册四个面向模型的工具（`plugin_search` / `plugin_install` / `plugin_uninstall` / `plugin_status`），与浏览器面板读写同一份安装态：`plugin_search { query?, source?, refresh? }` 把已注册索引源的目录条目（id、形态、来源、能力面、描述、所属源及其信任级别）渲染为每行一条文本；`plugin_install { source }` 返回一行安装结果（安装的 id 与版本，以及重启要求）；`plugin_uninstall { id }` 返回一行移除结果；`plugin_status { id? }` 每个已装插件返回一行（id@版本、安装来源、禁用标记）。它们的名称、描述与 JSON-Schema 参数编入 [tool-catalog.zh.md](../../../docs/tool-catalog.zh.md)，经常规系统提示词工具装配到达模型。

#### Token 影响

四个工具 schema 加入系统提示词输出的工具目录；执行结果是受已装/目录条目数量约束的短文本行。

#### KV Cache 影响

除每个模型请求已携带的共享工具目录装配外无其他影响。

### 回环网关

#### 模型看到的内容

无：`/plugin-installer` RPC 通道仅回环，不发起模型请求，也不注册其他模型可见内容。下载（配置的 npm registry、codeload、GitHub API）与 `pnpm`/`git` 子进程不产生模型可见输出。

#### Token 影响

当前进程为零；安装流量留在宿主内，从不进入模型请求。

#### KV Cache 影响

无；网关不给任何 provider 请求贡献内容。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- packument 未声明 `dist.integrity` 的 tarball 仅以 HTTPS 传输信任，不做内容校验。
- 配置的 `githubMirror` 是第三方服务，能看到（也可能篡改）下载内容——镜像前缀是显式开启的，设置前应知情。
- 非 GitHub 的 git 来源需要本机存在 `git` 二进制（Windows 安装可能缺失；GitHub 仓库经 codeload 下载、无需 git，但 commit 查询受未认证 GitHub API 的 60 次请求/小时速率限制，设置 `GITHUB_TOKEN`/`GH_TOKEN` 可解除）；根目录没有 `package.json` 的仓库（或空仓库）会被拒绝——只有单包 Node 仓库可安装，多包 workspace 根应改装其已发布的 npm 包。
- 依赖树只为 bundle 风格包（`dsh.bundle.patch`）安装；普通插件从应用内置依赖闭包解析自己的依赖。
- 聚合插件卸载后，其 bundle 依赖包仍留在 fallback——它们是未跟踪的支持文件而非已记录插件；后续安装会复用匹配副本或刷新到新的目标版本。
- bundle 中 id 已被 profile patch 拥有的 insert 行会被跳过，既有行（例如预设产品行）保持对该条目的唯一权威。
- 已安装插件在重启后以完整宿主权限运行——安装任意包是用户拥有的代码执行决策。
- 启动失败环形记录覆盖 JS 可捕获的加载失败、启动超时与延迟拒绝；硬崩溃或主线程挂起不会留下记录（这些恢复路径由桌面端的启动标记兜底）。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
