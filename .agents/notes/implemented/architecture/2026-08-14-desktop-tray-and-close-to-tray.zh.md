# Agent Note: DSHCode 系统托盘与关闭隐藏窗口策略

Status: implemented

[English](2026-08-14-desktop-tray-and-close-to-tray.md) | 中文

> 范围：仅桌面应用外壳——托盘的常驻与动作、关闭隐藏到托盘的窗口策略，以及 Windows/Linux 上移除 Electron 默认菜单栏。扩展 [DSHCode Electron 桌面外壳](2026-08-13-electron-desktop-loopback-shell.md) 决策。

## 问题

在 Windows 上，桌面窗口顶部渲染了两行占满全宽的栏：原生标题栏（应用名加窗口控制按钮），以及其下方 Electron 的默认菜单栏（File/Edit/View/Window/Help）。菜单行既不属于标题，也不属于窗口按钮，看起来异常宽，这正是未定制 Electron 窗口的常见毛病。

桌面外壳此前也没有后台存在感。在 Windows 与 Linux 上关闭窗口即退出应用，因此没有窗口打开时无法让 Harness 树继续运行，也没有入口把它带回来。产品需求是默认提供系统托盘：从托盘启动/恢复窗口、从托盘右键菜单退出、点击窗口关闭按钮时隐藏到托盘。

## 决策

### 托盘由主进程持有

`apps/desktop/src/main.ts` 在应用就绪后安装一个 `Tray`，图标来自打包进应用的 `assets/` 目录（经 ESM 安全的 `mainDir`（`fileURLToPath(new URL('.', import.meta.url))`——ESM 主进程没有 `__dirname`）相对 `lib/` 解析）：所有平台统一使用彩色应用 logo，macOS 显式装载 `tray16.png`（16 px）与 `tray.png`（32 px）这一对 1x/2x 表示，保证 Retina 屏幕上菜单栏 logo 清晰。Windows 与 Linux 上 `tray.on('click')` 绑定为显示窗口；macOS 遵循平台惯例，点击托盘即弹出上下文菜单。菜单提供「显示主界面」与「退出」。托盘创建做了防护：部分 Linux 桌面没有托盘宿主，此时关闭策略降级为真实关闭。

托盘的显示动作复用同一个 `showMainWindow()` 辅助函数：最小化窗口恢复、隐藏窗口显示并聚焦、已销毁窗口则对着仍在运行的 application URL 重建。Electron 单实例锁的 `second-instance` 处理器现在也调用同一个辅助函数，因此重复启动同样能唤回隐藏在托盘中的窗口。

### 未进入真实退出时，关闭即隐藏

窗口 `close` 事件被拦截：除非置位 `quitArmed` 标志，否则阻止关闭并把窗口隐藏。该标志在托盘「退出」动作与 `before-quit` 处理器中置位（后者本就拥有真实退出路径：`requestQuit` → Harness 关闭 → `app.exit`）。因此 `window-all-closed` 只会在真实退出关闭窗口时触发，现有处理器保持无害。当托盘不可用（无托盘宿主）时，关闭策略无法隐藏，行为与之前一样是真实关闭。

纯策略逻辑位于 `apps/desktop/src/lifecycle.ts`（`windowCloseDisposition`、`buildTrayMenu`、`trayIconFile`），vitest node 套件无需加载 Electron 即可覆盖。

### 仅 Windows 与 Linux 移除默认菜单

`Menu.setApplicationMenu(null)` 在 Windows 与 Linux 上执行，移除占满全宽的默认菜单行。macOS 保留系统菜单栏——应用菜单、标准编辑角色（复制/粘贴快捷键）与 Cmd+Q——这是平台惯例，也无法合并进窗口内一行。Windows 与 Linux 上的应用命令由托盘上下文菜单与内嵌 Web UI 承担。自绘单行标题栏是单独的后续决策。

## 验证

桌面生命周期套件新增三条用例：关闭处置在未进入退出时隐藏、托盘菜单模板以预期的中文标签接线 show 与 quit 回调、托盘图标文件选择在 macOS 返回 16 px logo 而其余平台返回 32 px 版。桌面类型检查与打包路径形态不变；暂存脚本现在会把 `assets/` 拷入打包应用，使托盘能解析到图标，由既有生产暂存冒烟覆盖。Windows 托盘行为（点击显示、上下文菜单、关闭隐藏）在原生 Windows 打包任务上人工核对。

## 备选方案

**保留默认菜单，只加托盘。** 已拒绝：宽菜单行正是被报告的缺陷，保留它等于标题栏问题未解决。

**现在就由渲染进程自绘窗口按钮（无边框窗口）。** 已拒绝：需要 preload/IPC 桥、拖拽区域样式与平台分支；托盘与关闭策略相互独立，先行落地。自绘标题栏是下一个桌面外壳步骤。

**无标志地一律隐藏而非关闭。** 已拒绝：退出路径会变成只隐藏永不退出；标志让唯一退出路径仍由既有关闭协调器持有。

**维持 window-all-closed 即退出，托盘做成可选项。** 已拒绝：产品需求是默认托盘，关闭隐藏是默认行为。

## 影响

- 应用有了持久的后台存在：窗口可隐藏到托盘，Harness 树继续运行，托盘可恢复窗口（重复启动同样有效）。
- Windows 与 Linux 上的真实退出经由托盘「退出」项，且仍等待 Harness 关闭控制器；误关窗口不再终止应用。
- Windows 与 Linux 窗口不再渲染默认菜单栏；macOS 不变。
- 无托盘宿主的桌面回退到原来的关窗即退行为，而不是报错。
- 打包应用新增两枚彩色托盘图标（`assets/`：`tray.png` 32 px 与 `tray16.png` 16 px），由 `icon.svg` 经 rsvg-convert 生成；运行时从 `mainDir/../assets` 解析，开发态与未打包目录布局均可用。
