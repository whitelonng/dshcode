# feedback/：记录的人类反馈

[English](README.md) | 中文

反馈家族只公开一份契约：写入权威 Session 日志的不可变评价。它绝不会进入模型对话。

| 包 | 职责 | ctx 键 |
|---|---|---|
| `command-feedback/` | 与触发方式无关的 `feedback/record` 事件，以及面向用户的 `/feedback` 生产方 | 无 |

command feedback 评价仅写入日志：它绝不会进入模型上下文或派生历史。挂载后，[`dsh-session-telemetry-otel`](../session/session-telemetry-otel) 会观察 `feedback/record`，以释放待处理的遥测前缀，或在遥测已禁用时警告反馈将留在本地；采集本身与该策略相互独立。
