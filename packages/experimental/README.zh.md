# experimental/：私有实验性包

[English](README.md) | 中文

本组包含使用仓库真实运行时、但不进入正式发布的原型与内部专用 Cordis 插件。组内包均为私有包，不承诺稳定性或支持，但仍须满足与发布包相同的工程、安全、文档、生命周期、测试和快照要求。

| 包 | 职责 | ctx key |
|---|---|---|
| `agent-team/` | 隐式 root Agent Teams roster、持久 peer mailbox、共享任务 DAG 与运行时协调 | `ctx.agentTeams` |
| `tool-agent-team/` | 按 Agent 作用域提供的 Agent Teams 模型工具与协作指引 | — |

[子树规则](AGENTS.md)规定依赖隔离、发布排除与 promotion。
