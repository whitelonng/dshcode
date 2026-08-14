# Agent Note: DSHCode Windows 单行标题栏

Status: implemented

[English](2026-08-14-desktop-single-row-title-bar.md) | 中文

> 范围：桌面应用外壳——Windows 自绘单行标题栏、沙箱 preload 桥与窗口菜单 IPC。承接 [系统托盘与关闭隐藏](2026-08-14-desktop-tray-and-close-to-tray.md) 决策（已移除默认菜单栏并定义托盘归属）。

## 问题

移除 Electron 默认菜单栏后，Windows 上仍渲染两行堆叠：原生标题栏（产品名加窗口控制按钮）位于应用内容之上。产品需求是一行内同时容纳应用名、菜单与最小化/最大化/关闭按钮——即 VS Code 式布局。渲染进程绘制标题栏需要触及窗口控制能力，但按外壳安全姿态，渲染进程处于上下文隔离、沙箱且无 Node 的环境中，无法直接调用 Electron API。

## 决策

### Windows：隐藏标题栏 + 原生 overlay 控制按钮

仅 Windows 上主窗口使用 `titleBarStyle: 'hidden'` 并配 `titleBarOverlay`（白色 overlay、深色符号、高 38 px，与外壳浅色主题基础表面一致）。最小化/最大化/关闭按钮由操作系统绘制在同一行；随主题变化的 overlay 颜色是后续项。macOS 与 Linux 保留原生标题栏。

### preload 桥是渲染进程唯一的新表面

新增沙箱 preload（`apps/desktop/src/preload.ts`）通过 `contextBridge` 暴露 `window.dshDesktop`：窗口框架模式（Windows 为 `custom`，其余为 `native`）、产品名，以及调用 `desktop:show-menu` IPC 通道的 `showMenu()`。主窗口把两个事实以启动参数传入（`--dsh-frame=custom`、`--dsh-product-name=<编码>`），因此桥负载解析放在 `apps/desktop/src/lifecycle.ts`，node 测试套件无需加载 Electron 即可覆盖。沙箱 preload 无法加载 ESM，所以 desktop 的 tsdown 配置把 preload 入口构建为 CommonJS（`lib/preload.cjs`），与不变的 ESM `lib/main.js` 并存（两个入口都构建两种格式；残留两个惰性兄弟产物，已在配置中说明）。

`desktop:show-menu` 处理器在弹出由纯模板构建的原生菜单（隐藏到托盘 / 重启应用 / 退出）前，会先校验发送方 frame 是否属于应用精确源（origin）。重启动作在已置位退出路径前先排队 `app.relaunch()`（打包版 Electron 无法热应用宿主插件，因此插件管理表面会原地重启整个应用）；退出动作复用关闭隐藏策略的已置位退出路径。

### web 壳仅在自定义框架下渲染该栏

壳组装（`packages/client/web/src/app.tsx`）用 `DesktopTitleBar` 组件包裹 root 插槽渲染。无桥或原生框架时，组件原样渲染子节点——普通浏览器与 macOS 的布局输出完全不变，现有快照与 e2e 覆盖保持有效。自定义框架下渲染一条可拖拽条（产品名 + 菜单按钮，`-webkit-app-region: drag`，按钮 no-drag），绝对定位覆盖顶部 38 px，同时带 padding 的 body 宿主让应用框架保持全高；`env(titlebar-area-width)` 保证内容不与原生 overlay 按钮重叠。

## 验证

桌面生命周期套件固定了桥负载往返（自定义框架 + 编码产品名、原生默认、缺失产品名）、发送方源校验与窗口菜单模板接线。client-web 套件在三种模式下渲染包裹器（无桥、原生框架、自定义框架），并断言菜单按钮调用桥。桌面与 client 类型检查通过；Windows 组装行为（单行、拖拽、overlay 按钮、菜单弹出）在原生 Windows 打包任务上人工核对。

## 备选方案

**完全无边框 + 渲染进程自绘窗口按钮。** 已拒绝：重复实现原生控件，图标切换需要最大化状态 IPC，且 `frame: false` 在 Windows snap/DPI 上有已知卡顿问题；overlay 以零渲染成本保留原生行为。

**由 profile 层 client 插件渲染顶栏（类似 compat shim）。** 已拒绝：所需座位由壳权威声明，插件拥有的 chrome 条会把窗口拖拽区耦合到可卸载的包上。顶栏是壳的 chrome，归壳组装所有。

**preload 使用 ESM。** 已拒绝：沙箱 preload 无法加载 ESM；preload 构建为 CommonJS，并保持为渲染进程唯一可见的 Electron 表面。

**现在就通过 IPC 同步主题化的 overlay 颜色。** 已拒绝：overlay 从与窗口背景一致的浅色表面起步；深色主题同步是小幅后续项，不改变布局决策。

## 影响

- Windows 上应用名、菜单按钮与原生窗口控制按钮位于同一行；默认宽菜单行彻底消失。
- 渲染进程恰好新增一个表面——preload 桥——且除经源校验的菜单 RPC 外只读；上下文隔离与 Chromium 沙箱保持开启。
- 普通浏览器与 macOS 的渲染输出与此前逐字节一致，共享壳测试与快照仍然是组装应用覆盖。
- desktop 构建产物现在为 `lib/main.js`（ESM，不变）加 `lib/preload.cjs`（CJS）与两个惰性兄弟文件；打包应用经由既有 `lib/**/*` files 项分发。
- overlay 颜色固定为浅色主题表面，直至主题化更新落地。
