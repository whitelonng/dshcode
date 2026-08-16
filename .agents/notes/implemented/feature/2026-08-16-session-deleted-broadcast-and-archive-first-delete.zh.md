# Agent Note: session-deleted 广播与侧边栏归档优先删除

Status: implemented

[English](2026-08-16-session-deleted-broadcast-and-archive-first-delete.md) | 中文

> 范围：[归档会话管理](../architecture/2026-08-14-archived-session-management.md)接缝的彻底删除增量——一个新的持久化事件、一个新的 host 流帧、与之配对的客户端驱逐，以及走归档集合的侧边栏删除动词。

## 问题

彻底删除归档会话时，宿主移除了日志与工作区账目，却没有通知任何已连接客户端。客户端会话列表镜像保留着过期摘要：归档集合帧把它从隐藏状态放出，账目移除又让它无家可归，于是在同一次连接窗口内重新出现在 Ungrouped 下。只有重连或刷新重建基线后，幽灵行才消失。

侧边栏还只暴露「归档会话」动词，而归档设置页描述的却是删除流程。想删对话的用户转而使用删除工作区——它从不删除会话，只会把会话孤儿化到 Ungrouped。

## 决策

### 删除提交点上的持久化事件

`PersistenceCoordinator.delete` 在后端 `deleteStored` 落定后发出 `session/deleted(sessionId)`——两个第一方后端都委托到此处，因此只有这一个发射点。每次成功的 delete 调用都发一次，包括对不存在工件的幂等重复，使只依赖该信号的镜像必然收敛。事件声明在 dsh-session-persistence 的 `Events` 扩展中；apiproxy 测试 harness 的 stub 同样镜像该契约。

### host 帧与客户端驱逐

`HostFrame` 新增 `host/session-deleted`；host 流构建器订阅 `session/deleted` 并向每个连接推帧。`SessionManager` 用与 `host/session-removed` 相同的驱逐例程（`evictSession`）处理它，但有两处有意差异：持久 subagent 行也被直接驱逐（与 dispose 不同，其日志已不存在）；当前 selection 指向被删会话时清空 selection。

### 侧边栏删除即归档优先

会话行菜单动词改为**删除会话**（danger 样式、无对话框）：提交 `ctx.workspaces.archiveSession`，即归档优先的软删除——该手势不销毁任何东西，行随归档集合在所有视图隐藏，恢复与彻底删除由「归档会话」设置页承担。设置页空态文案如实描述该流程；`session-active` 的彻底删除拒绝通过结构化 `ArchiveActionError`（拒绝携带宿主错误码）映射为指明补救方式的文案。

## 验证

memory 持久化套件断言事件发射（契约后端都委托协调器）。apiproxy workspace 套件断言 `deleteSession` 先推 `host/session-deleted` 再推归档集合帧。连接 fixture 镜像真实宿主（账目移除、列表移除、三帧）并由其 spec 断言顺序。manager spec 覆盖 subagent 驱逐与 selection 清空。workspace-management e2e 把行菜单场景改为删除动词，并新增场景：从设置页彻底删除已归档种子会话，断言 Ungrouped 不复活——幽灵回归守卫。

## 备选方案

**复用 `host/session-removed` 表示彻底删除。** 已拒绝：该帧会把活会话销毁（日志保留、行可能随重基线回来）与不可逆删除混为一谈；共享的驱逐例程已经去重了行为，判别标签保持语义显式。

**设置页经由 workspaces 服务在本地驱逐。** 已拒绝：只能收敛发起操作的标签页，其他客户端仍留幽灵；帧是唯一的跨客户端通道。

## 影响

- `HostFrame` 多一个成员；旧客户端忽略未知帧（文档化默认行为），幽灵保留到其下次重基线——不劣于改动前。
- 「归档会话」菜单标签不复存在；归档机制保留（设置页与不变的 `archiveSession` 服务面）。
- 删除工作区注册记录的对话框不受影响：仍声明会话保留在 Ungrouped 下，与会话级删除路径明确区分。
