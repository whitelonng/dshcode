# Agent Note: 产品 subagent 公开有界结构化失败事实

Status: implemented
Archived: 2026-08-21

[English](2026-08-18-product-subagent-failure-facts.md) | 中文

## Problem

[Claude Code 与 Codex 产品提供方](2026-08-04-claude-code-and-codex-subagent-backends.zh.md)会收到结构化产品失败，但已发布运行以往会把其中大多数压成共享的 `error` 终止原因。产品日志保留了细节，前台父 agent 与[一次性后台 Job](2026-08-12-product-subagent-one-shot-background-tasks.zh.md)却无法据此区分产品限制、执行失败或进程提前退出。

若把 SDK 错误文本、app-server payload 或 stderr 复制进结果，就会暴露任务文本、路径、环境值、凭证或产品内部信息。若增加共享错误字段，又会让提供方无关的 [subagent seam](2026-06-21-subagent-capability-seam.zh.md)拥有彼此独立变化的产品版本词汇。

## Decision

每个产品提供方分别拥有从锁定版本官方结构化失败、当前操作和受管进程结果到一行固定安全诊断的映射。`SubagentResult` 保持不变：消费方仍接收现有的有界 `diagnostic` 字符串，而且不解析其中由产品私有的字段。[最小诊断决策](../simplification/2026-08-21-product-subagent-minimal-diagnostics.zh.md)已经取代本说明对 Claude Code 完整 subtype 的镜像；在 Codex 采用同一简化前，本说明继续负责其当前详细类别。

### 安全诊断

结构化行采用以下固定顺序：

```text
Product subagent failure (product: <product>; stage: <stage>; category: <category>; HTTP status: <status>; exit code: <code>; signal: <signal>)
```

提供方会省略不可用的可选字段。退出码与信号是相互独立的事实，只要已观测到就分别保留。来自[非交互权限决策](2026-08-15-product-subagent-noninteractive-permissions.zh.md)且参与失败的权限决定会跟在结构化行之后；最新的安全权限事实仍只属于当前操作。共享结果边界会把完整文本限制在 4096 个 UTF-8 字节以内。

成功结果与本地取消都不公开失败事实。原始产品错误、stderr、工具输入、路径、环境值、凭证和协议 payload 绝不会进入诊断。启动与清理拒绝会在 Error 消息中使用同一安全行。原始失败保留在内部 cause 链中；提供方 Host 日志与转发的 stderr 也只作为产品本地观测。

### Claude Code 事实

[最小诊断决策](../simplification/2026-08-21-product-subagent-minimal-diagnostics.zh.md)独占负责 Agent SDK 0.3.241 与 Claude Code 2.1.241 的 Claude Code 类别、阶段、进程事实、权限顺序与验证。本说明不再承载独立的 Claude 类别约定。

### Codex 事实

Codex app-server 0.147.0 定义十一种字符串类别与五种对象 variant。提供方会保留 `contextWindowExceeded`、`sessionBudgetExceeded`、`usageLimitExceeded`、`serverOverloaded`、`cyberPolicy`、`internalServerError`、`unauthorized`、`badRequest`、`threadRollbackFailed`、`sandboxError` 和 `other`。它还会保留 `httpConnectionFailed`、`responseStreamConnectionFailed`、`responseStreamDisconnected`、`responseTooManyFailedAttempts` 与 `activeTurnNotSteerable`；四种连接／stream variant 会保留数值 `httpStatusCode`，而 active-turn variant 不公开 `turnKind`。未知字符串、同时含其他 variant 的对象、格式错误值与未分类异常统一使用 `unknown`。

| 阶段 | 归属操作 | 可观察失败 |
| --- | --- | --- |
| `initialize` | App-server spawn 与 initialize/initialized 握手 | `start()` 以固定安全事实和已经观测到的进程结果拒绝 |
| `thread-start` | 临时 `thread/start` 请求与响应校验 | `start()` 以线程阶段和可用进程结果拒绝 |
| `turn-start` | 已发布 `turn/start` 请求、暂定 id 与早到 frame | 没有结构化类别时，运行以 `error` 和安全 unknown 回退兑现 |
| `turn` | 终态通知、最终答案选择与 error-info 映射 | 完整类别与可选 HTTP status 进入非完成结果 |
| `process` | 受管 app-server 在另一终态路径结算前退出 | 运行以 `error` 兑现，并携带 `process-exit` 以及可用的退出码与信号 |
| `teardown` | Wire 关闭与进程树释放 | `dispose()` 独立拒绝；启动回滚聚合会同时公开启动与 teardown 两行 |

`contextWindowExceeded` 仍是 `max-tokens`；其他所有已知或未知 Codex 类别仍是 `error`，`cyberPolicy` 不会变成 `refusal`。

### 所有权与生命周期

| 事实或资源 | Owner | 消费方行为 |
| --- | --- | --- |
| Codex 错误类别 | Codex 提供方及其锁定的官方 app-server | 提供方保留当前结构化类别，并在已识别集合之外使用 `unknown` |
| 当前失败阶段 | 产品提供方操作 | 只在失败点派生；绝不持久化，也不作为恢复状态 |
| 退出码与信号 | `dsh-subprocess` 进程句柄 | 提供方展示已观测值，不推测缺失值 |
| 诊断字节与送达 | `dsh-subagent`、前台工具与 Job 运行时 | 两种调度模式都把同一份有界文本与 assistant 输出分开呈现 |
| 原始产品失败 | 产品运行时、内部 cause 链与 Host 观测 | 只保留在内部，绝不成为模型可见的结果文本 |

## Verification

Claude Code 验证由[最小诊断决策](../simplification/2026-08-21-product-subagent-minimal-diagnostics.zh.md)负责。Codex 包测试固定当前全部十六种 error-info variant、HTTP status 存在与缺失、六个阶段、unknown 回退、终止原因保持不变、权限顺序、脱敏、取消、并发与清理聚合。真实 app-server fixture 会产生实际 Codex `internalServerError`，并覆盖进程／协议失败与整棵进程树完全停稳。无密钥 ACP snapshot 会在前台错误输出、后台完成通知和 `job_output` 中记录 Codex 诊断。

## Alternatives considered

**返回原始 SDK 错误、app-server payload 或 stderr。** 这些值可能包含命令、路径、工作区内容、环境值、凭证或上游文本。固定白名单映射可以保留可操作事实，同时不扩大模型可见的信任边界。

**增加共享产品错误 enum 或结构化结果字段。** Claude Code 与 Codex 各自独立版本化错误联合。共享 enum 会复制这些权威，并迫使无关提供方和消费方跟随产品版本。

**解析通用 stderr 与异常消息。** 自由文本既不稳定也不安全。只有锁定版本产品提供的结构化字段和受管进程结果可以成为诊断输入。

**持久化阶段或增加恢复控制器。** 阶段只在报告失败时从当前调用点派生。持久化、重试、resume 与修复需要独立的所有权和用户约定。

**把产品限制映射为新的共享终止原因。** Claude Code 的轮次和预算限制并不表示 token 窗口耗尽，错误类别也不能证明拒绝语义。既有终止原因保持不变。

## Consequences

父 agent 可以区分当前 Codex 的预算、用量、服务、策略、请求、连接、stream、回滚、sandbox 与 active-turn 类别，而不会收到原始产品文本。[最小诊断决策](../simplification/2026-08-21-product-subagent-minimal-diagnostics.zh.md)负责对应的 Claude 结果。前台与后台调度会保留同一事实，因为二者都消费同一个 `SubagentResult`。

诊断只是展示文本，不是新的公开协议。调用方可以呈现它，但不得根据其标点或产品私有类别名称进行分支。锁定产品版本升级时必须重新验证提供方映射与证据，但不要求每个官方错误成员都继续模型可见。

本决策不增加产品会话持久化、重试策略、恢复状态、stderr 分类器、身份验证或配置分类体系、进度流或人工交互路径。
