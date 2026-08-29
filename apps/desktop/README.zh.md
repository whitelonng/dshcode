# DSHCode 桌面应用

[English](README.md) | 中文

`@dshcode/desktop` 是 Electron 外壳，用于把现有 DeepSeek Harness Web UI 打包成可安装的 macOS 和 Windows 应用；它不会 fork 或复制渲染器 UI。

## 运行模型

Electron 主进程调用共享的 `@deepseek-ai/dsh/profile-boot` 入口，并在本进程内启动现有 `web` profile。应用不会 spawn CLI 进程，也不会启动需要单独管理的服务子进程。完整 Harness 树启动后，BrowserWindow 才会打开已激活 WebServer 服务报告的地址。

打包版 Electron 不开放 Cordis HMR（热模块替换）所需的 Node loader 内部能力。因此，桌面启动器会关闭 profile 级和 home 级 `cordis.patch.yml` 文件的实时监听；启动时仍会加载这两个文件的内容，Web UI 管理的普通设置也会保留各自的实时行为。手动编辑任一 patch 文件后，请重启 DSHCode。

## 插件启动失败恢复

一个不兼容的插件绝不能让应用打不开。启动失败会被归因到已安装插件，并记录到有界的按插件环形文件（`$DSH_HOME/boot-failures.json`，至多 8 条、90 天留存）；随后弹出原生恢复对话框，提供「继续（禁用插件并重启）」（禁用被归咎插件并重启——与设置页开关相同的 patch 行写入）、「安全模式启动」（跳过用户 patch 层启动，通过 `$DSH_HOME/safe-mode` 标记）与「退出」。设置中的插件列表为受影响的插件显示「启动失败」徽标，带「让 Agent 修复」（打开一个工作区为插件安装根目录 `$DSH_HOME/profiles` 的对话，首条消息内嵌失败记录与安装路径）与「复制错误」。硬崩溃与挂起由启动生命周期标记（`$DSH_HOME/boot-marker.json`）兜底：在标记写入 `ok` 之前死掉的启动会延续失败计数，连续三次失败后对话框默认选择安全模式。

## 安全与生命周期

- WebServer 只绑定 `127.0.0.1`，端口值为 `0`，由操作系统以原子方式选择一个可用的临时端口。
- Electron 只允许一个 DSHCode 实例。第二次启动时会聚焦现有窗口，不会再启动一棵 Harness 树或增加监听端口。
- 渲染器启用上下文隔离和 Chromium 沙箱，关闭 Node 集成，拒绝权限请求，并且只能在应用自身的精确源内导航。HTTPS 链接会在系统浏览器中打开；其他跨源目标会被阻止。
- 原生退出请求会先等待 Harness 关闭控制器完成。WebServer 的 dispose（资源释放）逻辑会关闭普通连接和升级连接；随后 Electron 退出，临时端口恢复可用。

## 系统托盘与窗口关闭

- 应用默认安装系统托盘图标（Windows/Linux 为彩色图标，macOS 为单色模板图）。Windows 与 Linux 上单击托盘会显示并聚焦主窗口；托盘右键菜单提供「显示主界面」与「退出」。macOS 遵循平台惯例，点击托盘直接弹出菜单。
- 默认情况下，点击窗口关闭按钮会把窗口隐藏到托盘：Harness 树继续运行，通过托盘可恢复窗口。真正的退出只发生在托盘「退出」项（或 macOS 应用菜单），并且同样会先等待 Harness 关闭控制器完成。
- Windows 与 Linux 不再显示 Electron 默认菜单栏（File/Edit/View/...）；macOS 保留系统菜单栏与标准编辑快捷键。
- Windows 上主窗口使用自绘单行标题栏：web 壳在可拖拽条中绘制产品名与菜单按钮，原生最小化/最大化/关闭按钮（`titleBarOverlay`）位于同一行。菜单按钮弹出原生菜单，提供「隐藏到托盘」、「重启应用」（原地重启应用以应用 profile 与 patch 变更）与「退出」。macOS 与 Linux 保留原生标题栏。
- 渲染进程通过沙箱 preload 桥（`lib/preload.cjs`，沙箱 preload 无法加载 ESM，故为 CommonJS）获得窗口框架模式与产品名；窗口菜单 IPC 处理器只接受来自应用源（origin）的发送方。
- 运行时托盘图标（`assets/tray.png` 32 px 与 `assets/tray16.png` 16 px，彩色应用 logo）由 `assets/icon.svg` 经 `rsvg-convert` 生成；macOS 以显式 1x/2x 表示对同时加载两份，保证 Retina 屏幕上菜单栏 logo 清晰。

## 构建

在仓库根目录安装声明的 Node.js 和 pnpm 版本，然后运行：

```sh
pnpm install
pnpm run desktop:package
```

`desktop:package` 会构建仓库，并为当前平台创建未封装的应用。`desktop:dist` 会生成已配置的分发产物。输出写入 `.artifacts/desktop/release/`。

### 平台构建目标

```sh
pnpm --filter @dshcode/desktop run dist:mac:arm64
pnpm --filter @dshcode/desktop run dist:mac:x64
pnpm --filter @dshcode/desktop run dist:win:x64
```

名为 `Desktop` 的 GitHub Actions 工作流会在原生 macOS 和 Windows runner 上执行相同目标。不支持把在 macOS 上交叉编译 Windows 安装包作为验证路径。

`desktop-v*` tag 会把完整且成功的构建矩阵与 `SHA256SUMS.txt` 发布到 [GitHub Releases](https://github.com/whitelonng/dshcode/releases)。手动运行工作流时，安装包只作为普通 Actions 产物保留，不会创建 Release。

## 打包

暂存脚本会在源码工作区之外创建仅含生产依赖的 `pnpm deploy` 目录。部署前会验证每一个必需的工作区对等依赖（peer dependency）都是直接运行时依赖，从而避免安装后才出现包解析失败。由于 `pnpm deploy` 会把生产过滤条件写入共享工作区状态，暂存结束后还会恢复完整的源码工作区安装状态。

应用使用非 ASAR 资源，因为 Harness profile 回退机制需要创建真实的包符号链接。分发包包含上游 MIT 许可证、生成的第三方声明和独立 DSHCode 应用图标；内嵌 Web UI 保留上游署名。虽然 electron-builder 要求 Electron 在源码 manifest（元数据清单）中保持为开发依赖，但许可证生成器会把它视为实际分发的运行时依赖。

## 当前限制

- 预览版安装包目前明确保持未签名状态。在后续版本配置平台签名及 macOS 公证前，macOS Gatekeeper 与 Windows SmartScreen 可能会对本地构建发出警告。
- 尚未配置自动更新。
- 内嵌 Web UI 保留上游身份标识，但桌面应用与安装器使用独立 DSHCode 图标；详见仓库的[许可证与品牌声明](../../README.zh.md)。
- 恢复对话框、托盘与自绘标题栏需要在原生 Windows 构建上手动验证。
