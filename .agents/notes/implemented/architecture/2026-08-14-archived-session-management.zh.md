# Agent Note: 归档会话管理——恢复与彻底删除

Status: implemented

[English](2026-08-14-archived-session-management.md) | 中文

> 范围：让归档集合变得可管理的完整垂直切片——持久化层的持久删除、工作区账目层的恢复/移除、三个 workspace RPC、客户端运行时方法与设置页。扩展 [workspace 归档集合](2026-08-13-session-content-search-opt-in.zh.md) 机制与 [session 持久化协调器](2026-07-19-gui-layering-and-rpc-protocol.zh.md) 接缝。

## 问题

归档会话曾是一条单行道：`workspace.archiveSession` 会把会话从所有分组表面隐藏，但没有任何 UI 列出归档集合，没有 RPC 把会话移出集合，整个技术栈里也不存在持久删除——`SessionPersistence` 严格只追加，没有移除原语。用户一旦归档对话，就再也看不到它，更谈不上彻底删除。

## 决策

### 持久化层的持久删除

`SessionPersistence` 新增 `abstract delete(id)`，两个第一方后端都经由协调器实现。`PersistenceBackend` 接缝新增可选的 `deleteStored(id, signal?)` 钩子（与 `loadStoredFrom`/`locate`/`close` 一样可选）；协调器的 `delete` 会丢弃内存状态、使已准备的读取失效，并在后端缺少该钩子时明确报错。JSONL 后端通过既有的按 id 扫描解析日志路径并删除会话专属目录；SQLite 后端在单个事务中删除事件行与会话行。删除对下一次 `list` 观测可见，因此搜索索引会自动对账移除。共享持久化契约新增一条删除往返测试，所有后端都会执行。

### 注册表的恢复与账目移除

`WorkspaceRegistry.restoreSession(id)` 从归档集合移除一个 id（幂等，保留账目槽位，使会话在原位置重新出现）。`WorkspaceRegistry.removeSession(id)` 从每个所属 workspace 分离该 id（`WorkspaceEntity.detachSession`，幂等）并从归档集合移除；未知 id 为 no-op。两者都经由注册表的操作链写入，因此 `host/archived-sessions-changed` 帧会自动触发。

### 线层表面

三个新增 workspace RPC，均带 zod schema、fetch 路由与类型化 client 方法：

- `workspace.restoreSession` —— 取消归档；返回完整更新后的集合。
- `workspace.deleteSession` —— 彻底删除；拒绝 `not-archived` 与 `session-active`（活跃会话必须先关闭）。日志删除是不可逆步骤且最先执行；工作区账目在其落定后才移除。附件字节是 content-addressed 且跨会话共享，因此有意保留（见影响）。
- `workspace.listArchived` —— 归档集合加上尽力而为的标题（由 `sessionQuery.readTitleSnapshots` 折叠）与持久化头部列表中的创建时间；sessionQuery 缺失时条目优雅降级。

`deleteSession` 刻意不暴露给 agent 工具目录：它是破坏性操作，仅限产品表面。

### 客户端运行时与设置页

客户端 `workspaces` 服务与 manager 新增 `restoreSession`/`deleteSession`，通过既有的 `installArchived` 投影安装返回的归档集合（与 `archiveSession` 相同的回声纪律）。新增 client 包 `@deepseek-ai/dsh-client-ui-settings-archive` 注册 `settings.section` 页面 `archive`（导航顺序 30，位于 Models 之后）：每个归档会话一行（折叠标题或 id、创建时间），带「恢复」与「彻底删除」操作。删除需要显式确认弹窗；失败内联呈现并保留该行。线面调用共享的 `/api` 载体（`connection.rpc.call('/api', 'workspace.*')`），并在 `protocol.ts` 中校验响应，与 plugin-control 标签页模式一致。

## 验证

持久化契约套件在 memory、JSONL（纯文本与 zstd）与 SQLite 后端上运行新增的删除往返测试。workspace 注册表套件覆盖恢复幂等与账目移除。API 代理套件覆盖恢复、对非活跃持久化会话的成功删除与两个拒绝码；client-runtime 套件覆盖回声投影与失败传播；设置包覆盖页面流程（恢复、确认删除、取消、错误、空态）与 section 注册。web 回放套件重新录制设置对话框快照，该快照现在包含「归档会话」导航行。

## 备选方案

**删除时对附件文件做垃圾回收。** 已拒绝：附件是 content-addressed 且共享的，删除要么扫描每个剩余日志找引用（每次删除 O(全部日志)），要么维护引用索引。两者都是独立子系统；v1 删除对话数据并留下孤儿字节，作为已知限制记录，未来再做 GC 通道。

**把 deleteSession 暴露给 agent 工具目录。** 已拒绝：彻底删除是仅限用户的产品动作；工具调用会让模型在未经确认表面的情况下销毁对话历史。

**把页面并入既有设置包。** 已拒绝：该页面是独立功能域（会话生命周期，而非插件或模型）；一个功能 = 一个插件包，section 插槽让壳保持与页面文案解耦。

## 影响

- 归档集合现在完全可管理：恢复让会话回到其 workspace 位置，彻底删除移除持久化日志与其账目。
- 会话活跃时删除会被 `session-active` 拒绝；客户端先关闭对话，用户才能到达页面操作。
- 已删除会话的附件字节保留在磁盘上，直到未来的引用计数 GC；确认弹窗明确说明这一点。
- 不能删除的后端（第三方）继续工作；协调器只在真正调用 `delete` 时明确报错。
- 设置对话框导航新增一行（归档会话），改变组装设置快照。
