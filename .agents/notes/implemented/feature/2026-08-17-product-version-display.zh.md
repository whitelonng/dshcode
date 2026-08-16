# Agent Note: GUI 中显示产品版本

Status: implemented

[English](2026-08-17-product-version-display.md) | 中文

## 问题

下载了 DSHCode 桌面应用的用户——或打开 `dsh web` 提供的 Web GUI 的用户——无法得知当前运行的是哪个版本。应用内部没有任何界面显示版本号：侧边栏没有、设置弹窗没有、窗口外观也没有。反馈问题与核对更新只能退回去看安装包文件名或操作系统的程序元数据，而这两者在应用运行起来以后都不可见。GUI 在桌面壳与浏览器之间共享，因此任何显示方式都必须同时在两种环境生效。

## 决策

产品版本改用自有版本线——`1.0.0`，后续按 `1.0.1` 等递进——不再跟随上游 harness 的 `0.1.0-rc` 序列。工作区本就共享同一版本：`check-workspace-constraints` 要求每个 `@deepseek-ai/dsh-*` 包与根清单一致，`scripts/release/bump.ts` 会一并推进家族、根、`apps/cli` 与 `apps/web`；`apps/desktop`（`@dshcode/desktop` 产物）随之同步提升。桌面发布保留 `desktop.yml` 据以构建与发布的 `desktop-v*` tag 前缀。

版本经由两条载体进入浏览器，每种环境各一条：

- **桌面桥**——`apps/desktop/src/main.ts` 把 `app.getVersion()` 通过 `desktopLaunchArguments` 以 `--dsh-app-version=<编码>` 传入（产品名与版本参数在所有平台携带，自定义框架参数保持仅 Windows），`desktopBridgePayload` 解析进桥负载，渲染层读取 `window.dshDesktop.appVersion`。这是打包应用自身的版本——即用户下载到的版本——即使未来某个仅桌面的补丁单独推进它，它对桌面产物仍是权威来源。
- **启动图**——client-modules 的 node 半边一次性读取自身 `package.json` 的版本，作为 `WebBootGraph.version` 注入 `window.__DSH_BOOT__`，与 `rev`、`entries` 并列。自身清单在每种布局（源码树与打包后的 `node_modules`）中都紧邻可解析，且按工作区约束与产品版本相等，因此无需解析根路径。`parseBootManifest` 在 wire 边界校验该字段（缺失或非字符串的版本会抛错，与其他 wire 成员一致）。

显示是壳级 chrome：[`VersionCaption`](../../../../packages/client/web/src/VersionCaption.tsx) 渲染一条 muted、点击穿透的字幕（`position: fixed`，屏幕右下角，`pointer-events: none`），作为壳装配（`app.tsx`）中 `DesktopTitleBar` 的兄弟节点。版本经 [`appVersion`](../../../../packages/client/web/src/app-version.ts) 解析——桌面桥优先，启动图次之——两条载体都没有版本时（孤立测试）不渲染任何东西。它作为框架旁的壳级 chrome，在桌面窗口与浏览器中都悬浮于布局之上，不触碰任何插件的 slot，也不触碰设置表面。

## 曾考虑的替代方案

**在设置弹窗内或侧边栏「设置」触发器旁加一行版本。** 最先做了原型（设置导航底部；触发行末尾字幕）。放弃作为最终展示，是因为版本应该在不开设置的情况下就可见——反馈截图必须自带版本——而且角落位置让设置表面与侧边栏底部布局都保持原样。两条载体（桥 + 启动图）无论如何都一样，因此挪动展示位置没有任何成本。

**只用桌面桥，不加启动图字段。** 桥覆盖桌面壳，但 `dsh web` 提供的浏览器页面没有桥，会什么都不显示。启动图字段让同一个组件在浏览器中也能工作。

**新增一个返回版本的宿主 API 端点。** 为一个页面加载时就已知的静态字符串引入新的 RPC 表面；注入的启动图无需往返请求、也无需新增服务就能携带它。

**从 client-modules 的 node 半边读取根 `package.json`。** 根相对于该包的位置在源码树与部署后的 `node_modules` 中并不一致，读取将需要布局知识。包自身清单永远只隔一跳，且按工作区约束与产品版本相等。

## 后果

启动图 wire 多了一个字段：`WebBootGraph`/`BootManifest` 类型、组合出的图、`parseBootManifest`、assembled-boot 与 HMR 测试夹具，以及生成的 typert 目录（`api-catalog.ts`，已重新生成）一并改动。桌面启动参数变了形态：每个平台的渲染层都会收到产品名与版本，而自定义框架参数保持由调用方仅 Windows 追加（曾经全平台传参导致 macOS 标题栏上叠画 Windows chrome；lifecycle 测试钉住了这个分工）。桌面桥类型（`DesktopBridge.appVersion`）与壳、插件安装器测试中的桥夹具都携带了新成员。字幕位于弹层之下（z-index 低于框架的 overlay 层与模态弹窗）且从不拦截指针事件，因此不会挡住它覆盖到的任何控件。
