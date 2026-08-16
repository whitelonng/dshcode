# Agent Note: session-deleted 广播与活会话的彻底删除

Status: implemented

[English](2026-08-16-session-deleted-broadcast-and-archive-first-delete.md) | 中文

> 范围：[归档会话管理](../architecture/2026-08-14-archived-session-management.md)接缝的彻底删除增量——一个新的持久化事件、一个新的 host 流帧、与之配对的客户端驱逐、删除时对网关持有活会话的销毁，以及两行缺失的错误 schema 分支（它曾让所有拒绝响应无法解析）。

## 问题

彻底删除归档会话时，宿主移除了日志与工作区账目，却没有通知任何已连接客户端。客户端会话列表镜像保留着过期摘要：归档集合帧把它从隐藏状态放出，账目移除又让它无家可归，于是在同一次连接窗口内重新出现在 Ungrouped 下。只有重连或刷新重建基线后，幽灵行才消失。

同一流程里还暴露出两个缺陷。`rpcErrorSchema` 判别联合一直没有补上归档功能加进 `RpcErrorDetailsMap` 的 `not-archived`／`session-active` 两个分支，任何拒绝响应都会在客户端校验失败，渲染成一段原始的 zod `invalid_union` 报错。而 `session-active` 拒绝本身就是死路：网关在创建时丢掉了每一个持有的 `AgentHandle`，会话永远不会离开 store，「请先关闭该会话」是没有对应操作的提示。

## 决策

### 删除提交点上的持久化事件

`PersistenceCoordinator.delete` 在后端 `deleteStored` 落定后发出 `session/deleted(sessionId)`——两个第一方后端都委托到此处，因此只有这一个发射点。每次成功的 delete 调用都发一次，包括对不存在工件的幂等重复，使只依赖该信号的镜像必然收敛。事件声明在 dsh-session-persistence 的 `Events` 扩展中；apiproxy 测试 harness 的 stub 同样镜像该契约。

### host 帧与客户端驱逐

`HostFrame` 新增 `host/session-deleted`；host 流构建器订阅 `session/deleted` 并向每个连接推帧。`SessionManager` 用与 `host/session-removed` 相同的驱逐例程（`evictSession`）处理它，但有两处有意差异：持久 subagent 行也被直接驱逐（与 dispose 不同，其日志已不存在）；当前 selection 指向被删会话时清空 selection。

### 彻底删除时销毁活会话

网关登记它创建或恢复的每个会话的 `AgentHandle`（`sessionDisposals`）。`workspace.deleteSession` 对活会话先经该句柄销毁——停止循环、注销 agent、移除会话——再删除日志：设置页的显式确认已等同于单独的关闭手势，删除帧会在每个标签页驱逐该行。网关之外创建的会话（subagent）没有销毁入口，保留 `session-active` 拒绝。

### 错误 schema 补全与侧边栏动词

`rpcErrorSchema` 补上 `not-archived` 与 `session-active` 两个分支，使每个拒绝都能解析，设置页经结构化 `ArchiveActionError` 把 `session-active` 映射为可操作的文案。侧边栏会话行动词保持**归档会话**（无对话框、非破坏性）；恢复与彻底删除由「归档会话」设置页承担，其空态文案如实描述该流程。

## 验证

memory 持久化套件断言事件发射。apiproxy schema 套件解析两个新错误分支；workspace 套件断言 `deleteSession` 先推 `host/session-deleted` 再推归档集合帧，且持有的活会话被销毁（agent 注销）而非拒绝。连接 fixture 镜像真实宿主（账目移除、列表移除、三帧）并由其 spec 断言顺序。manager spec 覆盖 subagent 驱逐与 selection 清空。workspace-management e2e 从行菜单归档、在设置页彻底删除冷会话，并断言 Ungrouped 不复活——幽灵回归守卫。

## 备选方案

**复用 `host/session-removed` 表示彻底删除。** 已拒绝：该帧会把活会话销毁（日志保留、行可能随重基线回来）与不可逆删除混为一谈；共享的驱逐例程已经去重了行为，判别标签保持语义显式。

**设置页经由 workspaces 服务在本地驱逐。** 已拒绝：只能收敛发起操作的标签页，其他客户端仍留幽灵；帧是唯一的跨客户端通道。

**仅以 `session-active` 拒绝活会话删除。** 第一轮发布后已拒绝：产品里没有任何关闭入口，拒绝即无法补救；改为销毁网关持有的活会话，该错误码仅保留给网关之外的会话。

## 影响

- `HostFrame` 多一个成员；旧客户端忽略未知帧（文档化默认行为），幽灵保留到其下次重基线——不劣于改动前。
- 在另一个标签页仍打开的会话也能删除：该标签页的行随删除帧消失，而不是报错。
- 侧边栏「归档会话」标签不变；设置导航改用归档字形，取代默认齿轮。
- 删除工作区注册记录的对话框不受影响：仍声明会话保留在 Ungrouped 下，与会话级删除路径明确区分。
