# Agent Note: 被取消的流定稿其已送达前缀

Status: implemented

[English](2026-08-10-cancelled-stream-prefix-finalize.md) | 中文

## Problem

被取消的流可能留下客户端继续渲染的 `assistant/chunk` 事件，但如果没有 `assistant/message` 记录已送达前缀，`deriveMessages()` 就会排除这部分内容。后续的「第二点展开讲讲」之类追问会缺少用户已读到的文本，在该轮次上创建的分支也会继承这个缺口。

模型历史必须包含取消后仍对用户可见的 assistant 内容。

## Decision

`ReactLoopAgent.step()` 在消费模型流期间捕捉取消，此时 `BlockAssembler`、已记录的分片 seq 和提供方路由可以确定已送达前缀。循环把该前缀追加为 step 的 `assistant/message`，并设置 `interrupted: true`、`surfaceOp: 'append'` 以及恰好包含已记录分片的 `sourceEventSeqs`。该追加先于 `step/end` 和记录 aborted 的 `turn/end`。

`BlockAssembler.interruptedBlocks()` 按流顺序返回内容非空白的已闭合和未闭合 `text` 与 `reasoning` 块。打断先于分派，没有真实工具结果，因此它会省略工具调用，也会省略空块和未闭合的未知块类型。返回结果为空时不追加 assistant 消息。提供方的 `error` 和 `aborted` finish 会在 `agent/request-error` 前离开流消费范围，因此提供方故障和恢复期间的取消都不会提交失败请求的内容。

Chat 和 Trajectory Conversation Definition 从持久消息读取 `interrupted`。Chat 渲染 Stopped 标记，Trajectory 则在 `step/end` 后把提供方请求保持在 error 生命周期，并保留持久结果 seq 和提供方信息。工具执行期间的取消遵循工具调度器约定，因为 assistant 消息已提交：已启动的调用生成真实结果，未分派的调用获得 `ABORTED_BEFORE_DISPATCH` 结果。

## Alternatives considered

**始终丢弃前缀。** 这能避免新增持久标记，但每次取消后的追问和分支都会缺少仍对用户可见的 assistant 内容。

**在投影时从分片组装前缀。** `deriveMessages()` 和客户端 Conversation Definition 都需要实现打断组装规则，日志中也没有该前缀的权威 assistant 消息。这还会让模型历史超出三类 `SurfaceEventType` 事件。

**保留完整工具调用并合成 aborted 结果。** 这些调用从未分派，合成结果会声称一个并未发生的执行结果，还会增加用户未收到的工具结果内容。

**追加 `[interrupted by user]` 之类模型可见的打断消息。** 这可以告诉模型前缀并不完整，但需要独立的来源类型、投影规则、UI 处理和本地化文案。持久的 aborted `turn/end` 保留了该后续决策所需的事实。

## Consequences

取消后的追问和分支会包含已送达前缀。ACP 桥会在结算 prompt 前排空按序传送的 assistant 输出，因此最后一条 `agent_message_chunk` 更新先于 cancelled stop reason。

终局提供方错误仍会丢弃已流出前缀。该不对称保留，因为 error 轮次的结束不来自用户的取消决定，需要独立的保留策略。

## Testing

`packages/core/agent-loop/tests/cancel.spec.ts` 覆盖内容、引用的 seq、事件顺序、下一请求的一致性、仅 reasoning 的输出、工具调用省略、恢复期间的取消和空前缀情形。`packages/llm/llm/tests/assembler.spec.ts` 覆盖 `interruptedBlocks()`。`packages/client/ui-chat/tests/conversation-node-definitions.client.spec.ts` 和 `packages/client/ui-trajectory/tests/conversation-definitions.client.spec.ts` 覆盖两种客户端投影。keyless 的 `cancel` ACP 快照和 `goal-round-driver` goal 快照覆盖完整应用。
