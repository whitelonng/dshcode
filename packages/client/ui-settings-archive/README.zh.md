# dsh-client-ui-settings-archive

[English](README.md) | 中文

Web 设置中的归档会话页面。一个 section（`settings.section`，id `archive`）列出每个注册表级归档会话及其折叠标题与创建时间。搜索框按标题或会话 id 过滤行；每行带选择复选框与全选开关，选中后出现批量工具栏（恢复所选立即执行——恢复非破坏性；删除所选需要显式确认弹窗，随后逐行调用 `workspace.deleteSession`——不可逆）。单行操作：

- **恢复** —— 通过 `workspace.restoreSession` 把会话移出归档集合；会话在其原 workspace 位置重新出现。
- **彻底删除** —— 需要显式确认弹窗，然后调用 `workspace.deleteSession`；宿主从持久化中移除会话日志，并清除其 workspace 记账与归档集合条目，其 `host/session-deleted` 帧让每个已连接的客户端把该会话从列表镜像中驱逐（否则过期摘要会在 Ungrouped 下重新出现）。生命周期由网关持有的活会话会先被销毁——确认弹窗即代替单独的关闭手势。不可逆。

线面（`list` / `restore` / `remove`）由 `apply` 注入，走共享的 `/api` fetch 载体（`workspace.listArchived` / `workspace.restoreSession` / `workspace.deleteSession`），响应在 `protocol.ts` 中于客户端边界校验；RPC 失败以携带宿主错误码的 `ArchiveActionError` 拒绝，供区块把已知错误码映射为可操作的文案。

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
