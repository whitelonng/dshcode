# @deepseek-ai/dsh-client-ui-notifications

[English](README.md) | 中文

Web 系统通知特性的归属方：为两类事件弹出操作系统通知栏通知——会话等待授权、以及会话或后台任务完成——并拥有负责开关两者的“通知”设置分区。

事件接线只读对象层，从不扫描 DOM。[`NotificationsService`](src/client/notifications-service.ts) 订阅 `sessions.list` 快照 store（侧边栏渲染所用的同一权威数据源），把三种边沿折叠成通知：会话的 `pendingInteraction` 翻转为 `'approval'`、会话的 `running` 翻转为 false、以及 `jobsBySession` 镜像里后台任务离开 `running`/`stopping`。选择列表快照意味着从未实例化的会话也能弹通知——manager 在整个列表范围内跟踪它们的交互状态——而且一次订阅同时携带授权、会话状态与任务。授权总是通知（即使页面可见，被阻塞的任务也值得提醒）；完成通知只在 `document.visibilityState === 'hidden'` 时发，因为站内完成圆点已经覆盖了可见场景。

以 `(kind, id)` 为键的 5 秒去重窗口——授权与会话完成用会话 id，任务完成用任务 id——防止重连回放与快速重试刷屏。点击通知会聚焦窗口并调用 `sessions.open(sessionId)` 切换到所属会话。当工具名可用时（会话已实例化且其会话快照携带 `PendingWait`），通知标题为「需要授权：<toolName>」，否则回退到通用授权标题。

平台接缝是 [`NotificationSink`](src/client/notification-sink.ts)：浏览器用标准 Web Notification API，桌面壳内用 Electron preload 桥（主进程原生通知），特性检测优先走桥。两种表面都不存在的环境报告 `unsupported` 并静默跳过。两个开关通过常规设置作用域持久化在 `notifications` 设置命名空间（`approvals`、`completions`，默认均开启）；开启开关时首次使用会请求 Web 权限，被拒绝后开关保持开启，设置页展示状态并提供重试操作。node 半区在组合提供设置服务时注册命名空间 schema。

设置分区注册 `settings.section`（id 为 `notifications`），通过自己的 store 镜像偏好作用域与权限状态；分区与通知文案共用本包的 `settings.notifications` locale 命名空间。

## 模型体验

无，因为本包读取客户端对象层状态（会话列表快照）并为人类渲染系统通知，不触及 prompt、消息、schema、流或工具结果；它只通过设置线路写入用户自己的偏好字段。模型对授权与后台任务的视角仍属于 interaction 与 jobs 域。

#### KV Cache effect

无；本包从不组装或发送 provider 请求。

## 已知限制与暂缓事项

- **重连会让仍挂起的授权再次触发。** manager 在断开时清空交互状态、重连时回放，因此同一个授权在去重窗口过后可能再弹一次通知。这是有意为之——授权仍在阻塞任务——但连接抖动可能会重复提醒。
- **Web 权限弹窗受浏览器手势限制。** 浏览器只在用户手势中呈现 `Notification.requestPermission()`，所以请求跟随开关点击（以及设置页的重试操作）；恢复出开关已开但从未授权过的会话会保持静默，直到用户再次开启。桌面壳不受影响（原生通知无需权限）。
- **没有任务标签的任务完成通知读作会话标题。** 每个任务都带生产者标签，通用标题只是线路完整性的兜底。
- **无 e2e 场景。** 通知行为依赖浏览器 Notification API 与文档可见性，无头 e2e 无法稳定断言；行为由 jsdom 服务与组件测试钉住。
