# Agent Note: 授权与任务完成的系统通知

Status: implemented

[English](2026-08-16-os-notifications.md) | 中文

## 问题

Web 客户端只在页面内部呈现阻塞中的授权与已完成的工作：侧边栏的琥珀色圆点表示挂起的授权、绿色「完成」提醒表示已结束的会话，两者都只有在浏览器标签页聚焦并滚动到它们时才可见。切走标签页（或最小化桌面窗口）的用户得不到任何信号：会话被授权阻塞时工作会空等，直到用户碰巧回来看一眼——长任务完成时同样无人知晓。

宿主已经运行着完成提醒机器（`SessionManager.completedNotifications`，驱动侧边栏圆点），后台任务注册表也已经推送整快照 `session/jobs` 帧；缺的只是任何能触及页面之外的通道。

## 决策

新增客户端插件 [`@deepseek-ai/dsh-client-ui-notifications`](../../../../packages/client/ui-notifications/README.md)，把对象层边沿变成操作系统通知，并在「通用」设置里带一行通知开关与一个设置命名空间偏好对。

### 数据面：一次快照订阅

服务订阅 `sessions.list`——manager 的列表快照 store，与侧边栏渲染所用的同一权威数据源——并在相邻快照之间折叠三种边沿：

- `pendingInteraction` 翻转为 `'approval'`（授权通知）；
- `running` 翻转为 false（会话完成通知）；
- `jobsBySession` 中的后台任务离开 `running`/`stopping`（任务完成通知）。

选择列表快照而非逐会话会话快照，是因为它覆盖从未实例化的会话（manager 为侧边栏在整个列表范围内跟踪交互状态），并且一次订阅同时携带授权、运行状态与任务。授权标题的工具名在会话已实例化时从 `sessions.binding(id)?.session.getSnapshot().pending` 读取；否则标题回退到通用形式。

### 策略

- **授权总是通知**，即使页面可见：被阻塞的任务值得提醒。
- **完成通知只在 `document.visibilityState === 'hidden'` 时发**：站内圆点已覆盖可见场景，看着页面时再弹窗是噪音。
- **以 `(kind, id)` 为键的 5 秒去重窗口**——授权与会话完成用会话 id，任务完成用任务 id——吸收重连回放与快速重试。
- **点击会聚焦窗口并调用 `sessions.open(sessionId)`** 切换到所属会话。
- **两个开关**（`approvals`、`completions`，默认均开启）通过标准设置作用域持久化在 `notifications` 设置命名空间。开启开关时首次使用会请求 Web 权限（浏览器只在用户手势中呈现弹窗，所以请求跟随点击）；被拒绝后开关保持开启，设置页展示状态并提供重试操作。

### 平台接缝

`NotificationSink` 接口按环境拆分：浏览器用标准 Web `Notification` API，桌面壳用 Electron preload 桥。桌面桥保持最小——`notify({ id, title, body })` 加一个点击回显——主进程持有原生 `Notification` 实例，点击时聚焦窗口并把请求 id 发回，让渲染层打开目标会话。渲染层特性检测桥并优先使用，因此桌面页面不会重复请求 Web 权限。两种表面都不存在的环境报告 `unsupported` 并静默跳过。

## 备选方案

- **为授权订阅逐会话会话快照**：`PendingWait` 列表直接携带工具名，但只覆盖已实例化的会话——用户从未打开的会话会保持静默，而恰恰是那种时候通知最重要。列表快照用工具名换取全覆盖；binding 读取在常见情形下找回名字。
- **在 manager 的 `completedNotifications` 集合上通知**：该集合有意排除当前选中的会话，是为站内圆点服务的；通知服务需要原始的 running→idle 边沿（包括选中的会话，因为页面已隐藏本身就证明用户不在）并驱动自同一个快照。
- **DOM 轮询或 Web Worker 检查**：违反对象层唯一规则与 Web 层纯展示立场；快照订阅才是正规通道。
- **纯 Electron 侧通知**：桌面壳跑的是同一个 Web GUI；第二条通知路径会复制文案、开关与权限语义。渲染层单服务加 sink 让特性保持单一来源，浏览器路径对普通 `dsh web` 同样有效。

## 测试

jsdom 服务测试钉住三种边沿、attach 时基线、去重窗口、仅隐藏时发完成通知、设置门控、权限请求/拒绝/不支持流程与点击导航；node 环境测试钉住无 `window`/无 `document` 行为；sink 测试 stub `window.Notification` 与桌面桥；apply 测试在真实 slot 树上证明服务挂接，Host 测试证明命名空间注册。有意不加 keyless e2e：通知行为依赖浏览器 Notification API 与文档可见性，无头 harness 无法稳定断言（已记录在包 README）。

## 后果

- **重连可能重复授权提醒**：manager 在断开时清空交互状态、重连时回放，同一个授权在去重窗口过后可能再弹一次通知。已接受：授权仍在阻塞任务，且去重窗口能吸收快速抖动。
- **权限受浏览器手势门控**：恢复出开关已开但从未授权过的会话会保持静默，直到用户重新开启；设置页展示状态与重试操作。桌面壳不受影响。
- **桥是桌面的特性面**：未来任何由渲染层驱动的原生集成（托盘角标、Dock 计数）都扩展同一条 preload 桥，而不是新增第二条通道。
