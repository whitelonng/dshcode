# Agent Note: 用户消息编辑以 surface 替换重新生成整个轮次

Status: implemented

[English](2026-08-16-user-message-edit-and-regenerate.md) | 中文

## 问题

停止运行后无法修改刚发出的提示：删除（[消息删除](../feature/2026-08-16-message-deletion-and-transcript-removal.md)）会移除内容，但改错别字或换个说法意味着要当作新消息重打一遍，旧对话还留在历史里。

## 决策

编辑复用删除功能已经折叠的 surface `replace` 操作。替换就是新轮次自己的消息，而不是一个单独事件：`Agent.followup` 增加可选参数 `FollowupReplace { start, end, sourceEventSeqs }`，循环把该轮次第一条被认领的消息以 `surfaceOp: { op: 'replace', … }` 追加，而不是 `'append'`。待处理的改写由那次首次认领消费，并在轮次结束时清除，因此被拒绝的唤醒不可能把它泄漏到后续轮次。模型于是在旧轮次的位置看到编辑后的提示，重新生成直接回答它——没有重复的用户消息，也没有循环可见的第二个事件。

`sessions.editMessage`（apiproxy RPC）只接纳 surface 上最后一条用户消息（source 为 `user`），其余一律拒绝为 `edit-unavailable`，轮次运行中拒绝为 `agent-busy`；它把范围展开为整个旧轮次（直到下一条用户消息之前的节点），并走与 `session.prompt` 相同的持久内容与图片准入路径后调用 `agent.followup(message, replace)`。

客户端转录折叠（`foldTranscript`）现在直接从窗口派生隐藏区间：`message/delete` 区间加上人类 `user/message` 替换事件的 `sourceEventSeqs`。压缩检查点（plugin 来源的替换）不折叠——转录保留它已经展示过的被压缩历史。`input-message` 节点定义额外匹配人类编辑替换事件，让编辑后的气泡得以渲染；UI 在最后一条人类用户消息上（仅空闲轮次）加入编辑操作，打开内联编辑器，提交调用 `editMessage`，失败时保留草稿并给出重试提示。

## 备选方案

- **独立的 `user/edit` 事件加无消息轮次唤醒**：拒绝——驱动没有无消息唤醒路径，而独立事件会让编辑文本在 surface 上出现两次（编辑事件 + 被认领的 follow-up 消息）。
- **回填 composer 输入框**：本阶段拒绝——输入机拥有 chip/装饰状态；内联编辑器在不引入机器级编辑模式的前提下，交付同样的「停止 → 修改 → 重新生成」流程。
- **物理截断**：与删除相同的只追加理由，拒绝。

## 后果

- 编辑是整个旧轮次的 surface 替换：派生历史恰好包含一条编辑后的提示及其新回答。
- 原始日志保留原轮次与替换事件；回放可重建模型可见状态与转录状态。
- 只有会话的最后一条用户消息可编辑；更早的消息需要删除或分支，删除功能已覆盖。
