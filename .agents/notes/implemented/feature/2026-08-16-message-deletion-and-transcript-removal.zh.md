# Agent Note: 消息删除从追加式日志中移除会话轮次

Status: implemented

[English](2026-08-16-message-deletion-and-transcript-removal.md) | 中文

## 问题

会话一直无法删除消息：点赞/点踩伴随记录（[已归档伴随记录笔记](../../archived/architecture/2026-08-10-message-feedback-sidecar.md)）只能记录评价，不能改动会话内容，说错的或已结束的对话永远留在模型可见历史里。用户要求在停止运行后能删除智能体回复和自己的消息，旧内容同时从屏幕和模型可见历史中丢弃。

## 决策

会话 surface 新增第三种操作。`SurfaceOp` 原本只有 `append` 和 `replace`（压缩在用）；新增的 `{ op: 'delete', start, end }` 无替换地移除一个区间，且只能由新的 `message/delete` 会话事件携带——其 `data` 重复该区间，`sourceEventSeqs` 引用每一个被移除节点（沿用既有来源校验规则）。surface fold 把这些节点拼接移除并递增 `replaceGeneration`，因此 `deriveMessages()`——模型可见历史的唯一来源——随之缩小。日志保持只追加：删除是可回放的操作，不是重写。会话不变式禁止在开启的轮次内追加 `message/delete`，删除因此永远不可能与模型执行竞争。

`sessions.deleteMessage`（apiproxy RPC）把一个目标消息 seq 展开为 surface 区间：用户消息删除整个轮次（直到下一条用户消息之前的节点）；assistant 消息删除自身及其同一步骤产生的工具结果，不会留下孤儿工具结果。运行中的智能体返回 `agent-busy`；非消息、未知或已被阴影的 seq 返回 `delete-unavailable`。子代理会话在本地以同样的 `agent-busy` 围栏拒绝。

客户端转录在会话组装器中折叠删除：`foldTranscript` 丢弃每个原始 `[start, end]` 区间与人类编辑替换事件被阴影的节点，剪除失去全部内容的轮次的 `turn/start..turn/end` 括号与被掏空步骤的 `step/start..step/end` 括号，并且从不渲染删除标记本身。该折叠应用于每次窗口重建（打开、前翻页、重同步），删除因此经得起分页与重连。UI 在人类撰写的用户气泡与 assistant 轮次尾部加入删除操作（有轮次运行中时禁用；RPC 失败时展示可重试的提示）。

点赞/点踩界面在同一改动中移除：删除 `dsh-client-ui-message-feedback` 与 `dsh-message-feedback` 两个包、其 Remote 挂载与 bundle 行，并把两条已实现笔记归档。

## 备选方案

- **在轮次边界物理截断日志**：拒绝——日志是投影、持久化后端与回放共享的只追加事实源；在线截断需要逐后端改造，还会毁掉审计历史。
- **复用 `replace` 加一条空 assistant 消息**：拒绝——空 assistant 节点是 max-tokens 的约定，不是删除；它会用假节点污染派生与转录折叠。
- **像压缩一样只做模型侧阴影**：拒绝——人类转录也必须丢弃被删内容，因此客户端折叠是转录级操作，而模型折叠留在 surface 内。

## 后果

- 派生历史、`session-reference` 投影与聊天转录都排除被删区间；原始日志仍会回放原轮次加其删除操作。
- Token 统计与标题继续读取原始事件——删除一个轮次不会重新计费或改标题（可接受：统计描述的是跑过什么，不是用户留了什么）。
- 删除是持久的、模型可见的转录编辑；surface 现在以 append、replace、delete 作为完整的定位操作词表。
