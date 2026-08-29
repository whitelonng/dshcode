# context/ — 请求上下文扩展

[English](README.md) | 中文

在不定义工具的情况下添加模型可见的请求上下文的产品插件。`agent-instructions` 包含在默认 `dsh-agent-spine-demo` 组合包中，可通过组合包配置禁用；`time-context`、`tmux-context`、`session-reference`、`file-reference` 和 `file-reference-local` 需主动启用。

| 包 | 职责 | ctx key |
|---|---|---|
| [`session-reference/`](session-reference/README.zh.md) | 其他会话的有界快照 | `ctx.sessionReferenceResolver` |
| [`file-reference/`](file-reference/README.zh.md) | 文件引用发现 seam 与 `@file` 语法 | `ctx.fileReferences` |
| [`file-reference-local/`](file-reference-local/README.zh.md) | 本地文件系统文件引用提供方 | — |
| [`time-context/`](time-context/README.zh.md) | 当前时间与耗时上下文 | — |
| [`tmux-context/`](tmux-context/README.zh.md) | tmux 位置上下文 | — |
| [`agent-instructions/`](agent-instructions/README.zh.md) | 工作区指令上下文 | — |

会话引用见 [docs/subsystems/session-reference.md](../../docs/subsystems/session-reference.zh.md)；[`agent-instructions` 决策记录](../../.agents/notes/implemented/feature/2026-06-24-workspace-context.zh.md)规定了其按 agent（智能体）/会话隔离与生命周期拆分。
