# Agent Note: DSHCode Electron 桌面外壳使用临时回环 HTTP

Status: implemented

[English](2026-08-13-electron-desktop-loopback-shell.md) | 中文

## Problem

原有图形界面要求用户安装 Node.js、启动 `dsh web`、保持终端进程运行，并在浏览器中打开打印出的 URL。DSHCode 需要一个可安装的 macOS 和 Windows 应用，让用户直接双击即可启动不变的 Web UI，不需要自行操作 CLI（命令行界面）。

桌面端还必须拥有自己启动的 Web 服务。固定端口可能与另一个 DSHCode 或开发进程冲突，通配地址会把控制面暴露给局域网，未释放 Harness 树就退出 Electron 可能留下套接字或子进程。打包还有独立的失败方式：pnpm 工作区包把必需对等依赖（peer dependency）用作共享 Service Definition，因此部署可以成功构建，却在 loader 导入安装树中遗漏的对等依赖时才失败。

[GUI 分层决策](2026-07-19-gui-layering-and-rpc-protocol.md)同时保留了同源 Web 载体与将来的 Electron IPC 载体。现有 Web profile 已经拥有静态资源、HTTP API 路由、[WebSocket 下行载体](2026-08-04-websocket-downlink-carrier.md)、目录选择以及完整浏览器插件清单。替换载体会扩大首个桌面改动，却不会改变用户要求的界面。

## Decision

### 应用装配

`apps/desktop` 是私有的 `@dshcode/desktop` Electron 应用，产品名为 `DSHCode`，应用 id 为 `com.whitelonng.dshcode`。主进程调用共享的 `@deepseek-ai/dsh/profile-boot` 导出，并在本进程内启动现有 `web` profile；它不会 spawn CLI，也不会启动需要另行监管的服务进程。上游渲染器 bundle 与界面保持不变，桌面应用和安装器品牌则使用独立 DSHCode 图标。

`runProfile()` 把用户 patch 层监听变成启动器的显式选择。CLI 传入 `true`，保留 `cordis.patch.yml` 的实时行为。桌面端传入 `false`，因为打包版 Electron 不开放 Cordis HMR（热模块替换）所需的 Node loader 内部能力；启动时仍会组合两个 patch 文件，Web profile 挂载的设置提供方也会保留各自的实时行为。

BrowserWindow 保持启用上下文隔离和 Chromium 沙箱，关闭 Node 集成与 webview，拒绝渲染器权限请求，并且只允许在已激活应用的精确源内导航。HTTPS 目标会在系统浏览器中打开；其他跨源目标会被拒绝。Electron 单实例锁会在重复启动时聚焦现有窗口。

### 服务地址与关闭归属

每次桌面启动都会把 `--host 127.0.0.1 --port 0` 传给 Web profile。端口零把无冲突分配交给操作系统；启动器使用已激活 WebServer 服务报告的 host 与实际非零端口构造窗口 URL，并拒绝非回环 host 或无效端口。DSHCode 不存在固定端口。

Electron 退出路径会合并重复请求，等待共享 Harness 关闭控制器完成，并且只在整棵树结算后调用 `app.exit()`。WebServer 的 dispose（资源释放）逻辑拥有 HTTP 与升级连接，所以应用退出会先关闭监听器，再结束原生进程。Windows 在所有窗口关闭后退出；macOS 保留普通应用语义，在用户退出应用前，可从仍在运行的 profile 重新创建窗口。

### 打包运行时

electron-builder 使用在源码工作区之外暂存的仅生产依赖 `pnpm deploy`。`apps/desktop/package.json` 直接声明运行时依赖图中可达的每一个必需工作区对等依赖，通用 `verify-runtime-closure` 门禁会在每次暂存前检查该闭包。该显式列表属于分发元数据；依赖开发工作区链接，或只在运行时报错后逐个补 peer，都不是可接受的打包模型。

应用使用非 ASAR 资源，因为 profile 模块回退机制需要创建指向已安装插件包的真实文件系统符号链接。暂存目录包含根 MIT 许可证与生成的第三方声明；虽然 Electron 是 electron-builder 使用的开发依赖，声明生成器仍把它归类为实际分发的运行时内容。打包过程通过 pnpm 的 JavaScript 入口调用它，避免 Windows spawn 命令 shim，并传入 `--publish never`，防止 electron-builder 从单个矩阵任务发布。原生 GitHub Actions 矩阵会生成 macOS arm64、macOS x64 和 Windows x64 安装包；`desktop-v*` tag 会把完整且成功的矩阵与 SHA-256 校验和发布为一个 GitHub Release。

## Verification

桌面生命周期测试固定回环地址／端口零参数、已激活地址校验、导航策略、打包版 Electron 缺少主模块参数时的补全，以及合并关闭请求后的执行顺序。运行时闭包门禁覆盖已安装的工作区对等依赖图。生产暂存冒烟测试启动真实 Web profile，在操作系统分配的回环端口收到 HTTP 200，释放它，并确认该端口不再接受连接；原生 Electron 启动会运行同一暂存目录与窗口。平台 CI 会在每个目标操作系统上构建安装包，tag 工作流则证明只有在全部矩阵任务成功后才会发布 Release。渲染器、模型可见输入和 transcript（文本记录）输出均未改变，因此现有 Web 快照继续作为组装应用覆盖，无需增加重复的桌面 transcript。

## Alternatives considered

**通过 `file://` 加载已构建前端，不启动本地 HTTP 服务。** 放弃：现有应用依赖同源 HTTP API 路由和 WebSocket upgrade。把它们替换成新桥接会改变载体与渲染器行为，而不是打包当前 Web UI。

**现在就实现预留的 Electron IPC 载体。** 放弃：IPC 仍与客户端抽象兼容，但需要新的传输实现、preload 桥接、校验面和生命周期覆盖。回环载体不改动现有协议即可复用，并满足无 CLI 应用的要求。

**把 `dsh web` 作为子进程启动。** 放弃：安装后的应用需要定位或携带第二个启动器、解析就绪输出、转发环境与信号，并监管关闭。进程内 profile 启动让 Electron 直接拥有就绪与关闭状态。

**预留一个传统桌面端口。** 放弃：任何固定数字都可能与已有 DSHCode、CLI、测试或无关本地服务冲突。端口零消除了先检查后绑定的竞争，即使脱离产品单实例路径，多个独立启动也可安全并行。

**使用 ASAR 打包应用。** 放弃：现有 profile 回退机制必须把真实包路径作为操作系统符号链接目标。ASAR 虚拟路径不满足该文件系统要求。

**只依赖 `@deepseek-ai/dsh`，让 pnpm 推断对等依赖。** 放弃：必需工作区 peer 是共享运行时服务，而仓库策略关闭对等依赖自动安装。促成闭包门禁的暂存失败已经证明，精简根 manifest（元数据清单）并不是封闭的可执行部署。

**让 electron-builder 从每个 CI 任务直接发布。** 放弃：隐式发布会把单个平台构建与仓库凭据绑定，并可能在其他目标完成前暴露不完整 Release。矩阵任务只构建并上传产物，由一个依赖全部矩阵任务的任务拥有 Release。

**把桌面安装器放入 GitHub Packages。** 放弃：GitHub Packages 提供包管理器 registry，而不是通用安装器直接下载。GitHub Releases 能向 macOS 与 Windows 用户提供普通文件，并在旁边保存校验和。

## Consequences

- 安装用户不需要 Node.js 或 CLI 操作即可启动一个应用，维护者则继续只维护一套渲染器实现。
- DSHCode 运行期间拥有一个私有本地 HTTP 监听器；它仅限回环地址，使用不可预测的可用端口，并且会在进程退出前关闭。
- 手动编辑 profile 或 home 的 `cordis.patch.yml` 后需要重启应用；普通 Web UI 设置不受此限制。
- 桌面 manifest 包含较长的显式 peer 列表；每当遗漏新的必需工作区 peer 时，打包都会提前失败。
- 非 ASAR 应用资源比 ASAR 更大且更容易查看，换取 macOS 与 Windows 上正确的插件解析。
- 源码再分发遵循上游 MIT 声明。DSHCode 独立桌面图标把应用品牌与内嵌界面及官方署名徽章中保留的上游身份区分开。
- 带 tag 的构建会获得可永久直接下载的 Release 产物与校验和；在配置签名及 macOS 公证前，明确保持未签名的预览版仍会触发平台信任警告。
