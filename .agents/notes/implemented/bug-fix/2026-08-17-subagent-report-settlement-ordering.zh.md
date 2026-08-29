# Agent Note: Subagent report 先于其结算通知

Status: implemented

[English](2026-08-17-subagent-report-settlement-ordering.md) | 中文

## 问题

可继续 child 可以显式上报选中内容，之后还会产生一条由管理器撰写且无条件投递的结算通知。报告投递曾使用 `Agent.followup()` 并进入 parent 的 `next-turn` 队列，而面向运行中 parent 的结算投递使用 `Agent.steer()` 并进入 `next-step`。一个轮次的第一个 step 会先领取完整 `next-step` 批次，再领取一条 `next-turn` 消息，因此较晚的结算通知可能先于较早的报告到达模型。整体组装的报告场景必须使用 `reportDelivery: quiet`，才能避开这种不确定交错。[Issue #2600](https://github.com/deepseek-harness/deepseek-harness/issues/2600)记录了该缺陷。

report 工具要求 child 在发现会改变 parent 下一步动作的信息时上报。把这条消息推迟到后续轮次，既违背了工具的调度含义，也让具有因果顺序的消息分散到领取优先级不同的队列中。

## 决策

`SubagentReportDelivery` 为 `'quiet' | 'next-step'`，默认值为 `next-step`。Next-step 投递调用 `parent.steer()`，因此运行中的 parent 会在最近的安全 step 边界读取报告，空闲 parent 则会启动一个轮次。静默投递继续调用 `parent.inject()`，进入同一队列但不唤醒空闲 parent。

对于投递到驻留可继续 parent 的 next-step 报告，继续执行管理器会保留外围的 `sendWaking()` 与 `admitWaking()`。它们负责唤醒发送的准入记账，与消息面向 step 还是 turn 无关：接收方 Activation 在同步插入 inbox 与观察该唤醒的微任务之间保持在线。

### 不同 parent 状态下的顺序

运行中的 parent 会在同一个 `next-step` FIFO 中接收已接受的报告和该 child 稍后的结算通知。若 parent 在结算到达前变为空闲，它已经领取了报告；结算随后可以开启一个更晚的轮次，而不会反转观察顺序。

parent 处于 maintenance 时，报告占据 `next-step` 并锁存一次唤醒，而结算可能因为 maintenance 呈现空闲状态而占据 `next-turn`。首次领取仍会先取 next-step 输入，再取排队轮次。取消后提交的唤醒输入会由 `Agent.send()` 重定向到 `next-turn`，因此报告和结算会遵循核心 agent 的取消收敛，而不会绕过它。

### 验证

report 包把 parent 保持在一个活动模型请求中，提交 child 报告，再让该 child 结算，并断言等待中的 parent 批次按 `subagent-report`、`subagent-settled` 排序，且没有排队的后续轮次。独立覆盖还会固定重复报告形成一个 FIFO next-step 批次、空闲 parent 唤醒，以及可继续 parent 的唤醒准入记账。

整体组装的 ACP 报告场景使用随附默认值。调度围栏让 child 等到 parent 的委派轮次之后，并让 parent 保持 maintenance，直至结算跟在报告之后到达。报告会锁存唤醒，结算通知则排入后续轮次；maintenance 结束时，parent 先领取 next-step 输入、再领取 next-turn 输入，因此无需静默投递 overlay 也能按因果顺序观察两条通知。

## 备选方案

**保留 `wakeup` 名称，但把其实现改为 `steer()`。** 既有公开描述把 `wakeup` 定义为一个后续 parent 轮次。让该值复用于不同的 inbox 目标，会使配置无法准确说明自己选择的行为。预发布配置因此直接使用 `next-step` 名称。

**暴露 `quiet | next-step | next-turn`。** Next-turn 报告仍可能被稍后的 next-step 结算通知超越。要保住报告先于结算，需要跨队列顺序屏障；当前没有任何部署对 next-turn 隔离的需求强到足以承担该机制。

**把结算通知移到 `next-turn`。** 结算批处理刻意使用 next-step 队列，使多个一起结束的 child 只花费 parent 的一个 step，而不是各自一个轮次。移动结算会增加延迟和模型工作量，只为保留一个没有当前消费方的报告调度模式。

## 后果

- 报告可能延长已打开的 parent 轮次。它绝不会打断活动模型请求或工具执行；agent loop 只会在 step 边界准入它。
- 一起接受的报告会共享一个 next-step 批次，保持 FIFO 顺序，并减少原先每份报告各占一个轮次所造成的轮次放大。
- `wakeup` 配置值会被拒绝，而不是保留为别名。本仓库对预发布 Cordis 配置不作外部兼容承诺。
- 对于不得唤醒停驻 parent 的报告，`quiet` 仍是部署退路，同时保留既有风险：在另一条唤醒输入到达之前，没有模型会读取这些报告。
