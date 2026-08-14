# dsh-client-ui-settings-archive

[English](README.md) | 中文

Web 设置中的归档会话页面。一个 section（`settings.section`，id `archive`）列出每个注册表级归档会话及其折叠标题与创建时间，每行两个操作：

- **恢复** —— 通过 `workspace.restoreSession` 把会话移出归档集合；会话在其原 workspace 位置重新出现。
- **彻底删除** —— 需要显式确认弹窗，然后调用 `workspace.deleteSession`；宿主从持久化中移除会话日志，并清除其 workspace 记账与归档集合条目。不可逆。

线面（`list` / `restore` / `remove`）由 `apply` 注入，走共享的 `/api` fetch 载体（`workspace.listArchived` / `workspace.restoreSession` / `workspace.deleteSession`），响应在 `protocol.ts` 中于客户端边界校验。

## 模型体验

### 浏览器设置区块

#### 模型看到的内容

归档区块不产生任何模型可见内容。本页不发起任何模型请求，不持有对话上下文，也不注册任何面向模型的内容；列表由宿主的 `session-query` 服务经 `workspace.listArchived` 从持久化会话日志折叠而来。

#### Token 影响

当前进程内为零。

#### KV Cache 影响

当前进程内无影响；本区块不会给任何提供方请求带来变化。

## 已知限制与延期工作

- 附件字节是 content-addressed 且跨会话共享；彻底删除移除会话日志，但孤儿附件文件会保留到未来的垃圾回收通道。
- 列表在挂载与每次变更后刷新；在另一个窗口执行的删除会在下次打开本页时生效。
