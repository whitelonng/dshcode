# Agent Note: Web UI 槽位与 dsh-web-ui 兼容层

Status: implemented

[English](2026-08-14-web-ui-slot-seats-and-compat-shim.md) | 中文

> 范围：社区 dsh-web-ui 功能插件（任务看板、SSH 面板、右侧面板、Git 图谱、鲸鱼娘宠物、移动端远程、实时令牌统计）如何把 GUI 界面挂载到本 shell 上，以及 shell 为什么声明一个槽位和一个实时令牌投影读取。是对 [内置社区插件与 profile 级控制](2026-08-14-built-in-community-plugins-and-controls.md) 的延伸（同一次分发，本记录覆盖 GUI 挂载侧）；遵循[槽位系统标准](2026-07-22-slot-type-chain-implementation.md)。

## 问题

内置的 `@linxin666/dsh-web-ui-all@0.1.2` 插件在服务端已加载、客户端包也已下发，但七个功能界面一个都不出现：插件挂在两类本 shell 没有提供的挂载点上。任务看板、SSH 与 AionUi 风格右侧面板通过 MutationObserver 等待旧式 DOM 钩子（`[data-pane="sidebar"]`、`[data-pane="conversation"]`、`[data-dsh-frame]`）；Git 图谱、鲸鱼娘宠物与移动端远程则注册到没有任何条目声明的槽位（前两者用 `conversation.input.selector.context`，移动端远程插件回退到 `sidebar.footer.action`）。实时令牌统计注册了宿主投影（`liveTokenUsage`），但会话统计行从未读取它。每个缺失点都静默失败——observer 或 `slots.inject` 回调永远等下去——因此部署上不报任何错误。

DOM 钩子盖章后还暴露出第二个更隐蔽的缺口：shell 的槽位出口把每个槽位的内容包在一个 `display: contents` 的 div（`[data-slot="sidebar"]` 等）里。家族插件把 `[data-pane=…]` 的第一个元素子节点当作面板根，并期望其直接子节点里包含 shell 的按钮；出口包装层横在列与面板根之间，这个假设永远不成立——于是即使属性已盖上，任务看板与 SSH 依旧沉默。

## 决策

上游家族提供专用兼容层 `@linxin666/dsh-web-ui-compat`：它把旧式 `data-pane` / `data-dsh-frame` 属性盖到 shell 上，并在 DOM 变更时重新盖章。本发行版把该包（从已发布源码本地构建，BSD-3-Clause，保留署名）安装进 profile 的共享模块回退目录，并把 `ui-web-ui-compat` 行加入 `web` profile 的用户补丁层。兼容层只写属性、从不移除节点、不干扰 React 协调。

由于裸插件行是从打包应用自身的 `node_modules` 导入的（Loader 从自身所在位置解析，而非 profile 目录），兼容层还必须随桌面应用一起打包：`prepare-package.mjs` 把 profile 中已安装的包暂存进 `compat-extras`（镜像 skins-extras 机制），`electron-builder.yml` 经 `extraResources` 把它发布到 `app/node_modules/@linxin666/dsh-web-ui-compat`。

兼容层的盖章策略是包装层优先：当槽位出口包装层（`[data-slot="sidebar"|"conversation"|"details"]`）存在时，把 `data-pane` 盖到包装层上——此时包装层是文档序中第一个 `[data-pane]` 匹配，其第一个元素子节点正是面板根，与插件挂载代码假设的 DOM 形状完全一致；没有包装层的 shell 才回退到 css-module 列（`[class*="sidebarCol"]` / `centerCol` / `detailsCol`）。`data-dsh-frame` 盖到框架网格（侧栏列的父元素）上，供 AionUi 风格面板使用。

一个 shell 自有的槽位填补槽位类缺口，遵循槽位系统标准（children = 声明 + 授权，单一 `register` API）：

- `ui-conversation` 声明 `'conversation.input.selector.context'`（`list`、`session-maybe`），在每个会话阶段的输入卡上方渲染（未占用时经 `:empty` 隐藏，空位不占任何布局）。Git 分支芯片与宠物召唤按钮停靠在这里；session-maybe 与插件的冷启动到活跃阶段契约一致。

`ui-sidebar` 同期还声明过专供移动端远程配对入口的 `'sidebar.remote'` 脚部座位；该座位后来被移除，让已发布的插件经其 `sidebar.footer.action` 回退恰好渲染一次——见 [单一侧栏脚部动作座位](2026-08-18-single-sidebar-foot-action-seat.md)。

实时令牌统计端到端复用现有投影通道：插件的宿主半区已注册 `liveTokenUsage` 会话投影（桶 + `estimated` + `tokensPerSecond`）。`token-meter` 拥有 `LiveTokenUsageProjection` 类型与 `SessionProjectionMap` 条目；会话 `StatsLine` 读取 `useProjection('liveTokenUsage')`——会话运行中时，行首分组显示实时吞吐；运行结束后该分组消失，由已结算的平均解码速度分组接替。

## 备选方案

**只移植 DOM 兼容层、放弃槽位功能。** 否决：七个产品中的三个（Git 图谱、宠物、移动端远程）将始终不可见。

**从源码重建整个家族，把插件重新注册到既有槽位**（`sidebar.footer.action`、新的输入 dock 行）。否决：已发布的 0.1.2 包本就指向上述槽位（移动端远程插件此后也自带了 `sidebar.footer.action` 回退），移植槽位即可让已安装的 npm 产物工作，不必再维护第二条构建流水线。

**由独立兼容插件声明槽位。** 否决：槽位声明是 shell 权威（children = 认领），第三方包声明 shell 槽位会把 shell 的渲染权耦合到一个可卸载插件上。

## 后果

出厂 shell 现在多声明一个 session-maybe 槽位（外加移动端远程插件回退使用的通用 `sidebar.footer.action` 脚部列表）；空位不渲染任何内容，因此未安装社区插件的部署看不到任何布局变化。`liveTokenUsage` 投影键成为标准投影映射的一部分，其值经普通投影推送通道到达——缺失时（较旧宿主或插件被禁用），统计行直接省略实时分组。

兼容层是上游发布产物，与其他家族包并排安装在 profile 回退目录、并经打包暂存步骤随桌面应用发布；上游更新无需仓库改动即可替换。其插件行是用户补丁插入，晚于 bundle 层应用，可独立移除。仓库侧的痕迹只有打包暂存（一个函数 + 一条 `extraResources` 条目），不是兼容层的源码副本。

## 测试

ui-sidebar 与 ui-conversation 的 apply 规格断言新增 children 声明与卸载清理；sidebar-root 规格断言脚部动作座位在宽/窄状态下都收到 wide 标志；skeleton 规格断言 selector 上下文行在 hero 与活跃阶段都渲染；chat-stats 规格覆盖实时分组的行首位置、结算后消失与缺少吞吐读数三种情况。各包测试与客户端类型检查全部通过。另起一个独立的 `web` profile 进程验证了组装后的启动清单会下发兼容层条目与新 bundle，且 `liveTokenUsage` 投影照常注册。
