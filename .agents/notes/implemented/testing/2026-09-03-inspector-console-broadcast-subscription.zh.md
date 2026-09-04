# Agent Note：Inspector console 测试先证明订阅再广播

Status: implemented

[English](2026-09-03-inspector-console-broadcast-subscription.md) | 中文

## 问题

集成测试 "forwards Client Console objects through isolated realm sessions" 间歇性丢失被录制的 console 事件：已连接的 CDP 会话断言 `Runtime.consoleAPICalled` 却始终观察不到它，加长等待也无法修复。Inspector 的 console 路径全程无缓冲。会话一挂载 console domain 就宣告 `executionContextCreated`，但 client 要跨 bridge 处理完 `client-console/enable` 帧后才把该会话加入扇出集合，而 worker 的 runtime router 与 client 对没有存活订阅的会话都会丢弃 console 帧。落在该窗口内的事件永久丢失，轮询（`vi.waitFor`）只是反复读取一个从未收到该帧的会话缓冲。

## 决策

测试在等待内部发出哨兵 console 事件并重发，直到两个 CDP 会话都观察到它；此后才发出一次被测事件。观察到哨兵即证明两个订阅都已存活，其后无缓冲广播确定性地到达双方。测试以注释陈述该广播契约，并携带覆盖两次等待的显式测试级预算。

## 曾考虑的替代方案

**加长等待。** 先尝试过（等待从一秒加宽到五秒）后否决：轮询读取的是从未收到被丢帧的缓冲，更长的等待无法找回订阅前丢失的广播，只能缩小窗口，并在 coverage lane 的并发下再次失败。

**让 Inspector 为迟到的订阅者缓冲或回放 console 广播。** 否决：这是产品变更——按会话的内存成本与回放语义——不能由一个仅测试层的 flake 证明合理；现有尽力而为的广播契约正是被测行为。

**在发出前直接断言订阅状态。** 否决：订阅集合位于 client 的 console observer 内部，未通过 CDP 暴露；观察哨兵事件是测试可用的外部、契约级证明。

## 后果

测试不再因订阅时序而 flake，并钉住真实契约：对 enable 帧尚未处理完的会话，console 广播是尽力而为。等待预算保持有界而不再随机器负载增长；未来被录制事件再丢失即指向真实的扇出回归，而非测试自身的竞态。
