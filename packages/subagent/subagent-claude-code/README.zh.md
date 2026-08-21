# @deepseek-ai/dsh-subagent-claude-code

[English](README.md) | 中文

本包（package）注册由 Profile 命名、默认名称为 `claude-code` 的 Claude Code subagent 提供方。每次接受运行请求后，它都会在发起委托的会话工作区中调用官方 Claude Agent SDK，让锁定版本的 SDK 选择随包安装的平台 CLI，提交一个自包含的文本任务，并通过共享的 [`dsh-subagent`](../subagent/README.zh.md) 结果约定返回严格的最终答案或独立的安全失败诊断。

## 启动与所有权

`start(request)` 只接受非空的文本块序列，并根据父会话确定子级 cwd。它会创建一个私有 `AbortController`，调用官方 SDK 的 `query()`，并仅在 SDK 的 `spawnClaudeCodeProcess` 钩子已经提供由 [`dsh-subprocess`](../../subprocess/subprocess/README.zh.md) 管理的活动 CLI 句柄后发布此次运行。若在发布前发生失败或取消，它会关闭 query、终止所有已取得的进程树并等待其退出，然后拒绝 `start()` 调用。

SDK 接收由文本块原样拼接成的任务。提供方会完整迭代 SDK 消息流，而且只接受满足以下条件的 `result` 消息：其 `subtype: "success"`、`is_error: false` 且 `result` 非空白，之后迭代器还须正常结束。所有失败仍映射为 `error`：Agent SDK 0.3.220 的四种错误子类型保留准确类别；标记为错误或内容空白的成功消息成为 `invalid-success`；缺失结果成为 `missing-result`；未分类的 query 失败成为 `unknown`；CLI 提前退出成为 `process-exit`。诊断还会注明当前 `query-start`、`query-run`、`process` 或 `teardown` 阶段，并分别保留已观测到的退出码与信号。该提供方不会产生 `max-tokens` 或 `refusal`。

本地取消会在结果竞态中胜出并映射为 `aborted`，且不附带失败诊断。`dispose()`（资源释放）具有幂等性：它会中止此次运行、请求 SDK query 关闭、调用共享的进程树逐级终止机制，并等待整棵进程树退出。SDK 的优雅关闭只表达协议意图；进程是否完全停稳仍以子进程句柄为准。启动与清理拒绝会在 Error 消息中公开同样固定的安全阶段和进程事实，而原始产品或 Host 错误只保留在内部 cause 链与提供方的 Host 日志中。结果失败与独立的清理失败仍彼此分离。

## 原生设置与交互

提供方故意省略 SDK 的 `settingSources` 选项。因此，官方 SDK 会相对于父会话 cwd 读取宿主机常规的用户、项目和本地 Claude 设置，包括原生账户状态与产品配置。提供方既不复制也不过滤这些文件，也不会创建或修改登录状态。Profile 选择的 `permissionMode` 是唯一的 query 级覆盖：Claude Code 仍拥有其设置与沙箱，而所选原生模式决定这个无人值守 query 如何处理权限检查。

每次 query 都设置 `persistSession: false` 并禁用 `AskUserQuestion`。除 bypass 模式外，`canUseTool` 会立即拒绝仍需人工审批的请求。Plan 模式还会把 `ExitPlanMode` 放入 SDK 的 `disallowedTools`，因此原生 settings 无法预先放行回到执行模式的转换，模型必须把完整计划作为最终答案返回。MCP elicitation 会被拒绝，已知的拒绝回退对话会被取消，未声明的对话类型则使用 SDK 的无对话失败行为。这些决定都不会等待用户界面。当两类事实共同参与一次失败运行时，`SubagentResult.diagnostic` 会先写入结构化失败行，再写入最新的安全权限决定；共享结果边界会把完整文本限制在 4096 个 UTF-8 字节以内。成功运行与本地取消都不会公开已捕获的事实。

## 能力与上下文

本提供方不声明任何可选的启动时能力，并报告 `inheritsParentContext: false`。Claude Code 会接收独立文本任务和父会话 cwd，但不会接收父会话的对话、角色设定、工具筛选器、深度策略或结构化输出约定。每次运行都拥有独立的 SDK query、取消控制器、CLI 进程和不持久化的产品会话。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `claude-code` | `ctx.subagents` 中的非空注册名称；每个已挂载实例都需要唯一值。 |
| `env` | `{}` | 显式指定的 SDK/CLI 环境，叠加在由共享机制清除凭证后的父环境之上。 |
| `permissionMode` | `dontAsk` | 为该提供方实例的每次运行固定原生非交互权限策略。 |
| `disposeGraceMs` | `3000` | 共享进程树责任方各终止层级之间的宽限期，单位为毫秒且须为正有限值，并不得大于仓库共享的 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.zh.md)；随后资源释放会等待整棵进程树退出。 |

| `permissionMode` 值 | 原生行为 |
|---|---|
| `dontAsk` | 不弹出提示，直接拒绝尚未获授权的操作。 |
| `acceptEdits` | 接受文件编辑；其余权限提示由无人值守回调拒绝。 |
| `auto` | 由 Claude Code 原生分类器允许或拒绝权限请求。 |
| `plan` | 使用原生规划模式，拒绝执行审批，并把完整计划作为最终答案返回。 |
| `bypassPermissions` | 显式设置 SDK 的危险确认并跳过权限检查。 |

生产环境会省略 `pathToClaudeCodeExecutable`，因此 Agent SDK 0.3.220 会从自己的平台包中选择匹配的原生 `claude` 或 `claude.exe`，再通过 custom-spawn 钩子把该绝对命令交给 `dsh-subprocess`。提供方不会检查 `PATH`、重复实现平台选择，也不会回退到宿主 `claude`。原生设置与身份验证继续是权威来源，而 `permissionMode` 是唯一的 query 级策略覆盖。本插件不选择模型、不创建产品主目录、不执行登录，也不探测账户。具有凭证特征的环境变量会在显式 `env` 覆盖生效前被清除，因此供子进程使用的 API 密钥或 token 必须在该配置中显式提供。除非被覆盖，`ANTHROPIC_BASE_URL` 等非凭证端点变量以及 `PATH` 和 `HOME` 等普通环境变量仍会被继承；`PATH` 不参与选择 Claude 可执行文件。

本包是可选的 Profile Bundle。将它安装进目标 Profile 后重启该 Profile；安装会把锁定的 Agent SDK 与一个兼容的平台 CLI 载荷带入该 Profile，而包所声明的 `cordis.patch.yml` 层只注册休眠的 `claude-code` Host provider，不会启动 Claude 进程。移除该包后，下一次 Profile 启动会撤回这一 provider 及其私有运行时闭包。

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-claude-code
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-claude-code
dsh --profile <name>
```

安装决定 Host 可用性，而不是模型权限。Bundle 会提供休眠的默认 `claude-code` 配置项；Profile 可以替换该配置项的完整 config，也可以挂载更多具有不同 `providerName`、`permissionMode` 与 `env` 的配置项。加载实例本身不会在绑定工具调用前启动 Claude 进程。每个 `dsh-tool-subagent` 配置项指定一个提供方，并需要独立的 `toolName`，因此模型看到的是静态工具，而不是动态提供方选择器。完整 Agent Preset 携带对应的默认产品工具行并设置 `disabled: true`；复制一个 preset 后删除该字段，即可只向由该副本组装的 agent 暴露 `subagent_claude_code`。其 `one-shot` 策略会让省略 `run_in_background` 或传入 `false` 的调用继续在前台等待，而显式传入 `true` 会返回由父 agent 拥有的 Job ID，供 `job_output` 或 `job_kill` 使用。base host（基础宿主）与完整 preset 已提供通用作业注册表和控制工具。

下列独立组装展示完整的显式能力。基于 `@deepseek-ai/dsh-base` 的 Profile 保留已有 Job 配置项，新增产品提供方与工具配置项，而且不重复挂载 Job 服务。

```yaml
- id: subagent-claude-safe
  name: '@deepseek-ai/dsh-subagent-claude-code'
  config:
    providerName: claude-safe
    permissionMode: dontAsk
    env:
      ANTHROPIC_API_KEY: !!js process.env.ANTHROPIC_API_KEY

- id: subagent-claude-bypass
  name: '@deepseek-ai/dsh-subagent-claude-code'
  config:
    providerName: claude-bypass
    permissionMode: bypassPermissions
    env:
      ANTHROPIC_API_KEY: !!js process.env.ANTHROPIC_API_KEY
```

```yaml
- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

- id: tool-subagent-claude-safe
  name: '@deepseek-ai/dsh-tool-subagent'
  disabled: true
  config:
    provider: claude-safe
    toolName: subagent_claude_safe
    backgroundMode: one-shot
    maxDepth: provider-managed

- id: tool-subagent-claude-bypass
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: claude-bypass
    toolName: subagent_claude_bypass
    backgroundMode: one-shot
    maxDepth: provider-managed
```

## 产品兼容性与证据

运行时依赖精确锁定为 `@anthropic-ai/claude-agent-sdk@0.3.220`，其八个平台包都携带 Claude Code 2.1.220。普通安装会按当前操作系统、CPU 及 Linux libc 选择一个载荷。对于当前 darwin-arm64 载荷，`npm pack --dry-run --json` 报告压缩包为 74,858,812 字节、解包后为 256,908,856 字节；其他平台可能不同，这些数值只用于披露而不是安装阈值。无密钥真实产品测试会让 SDK 选择 CLI，通过回环 Messages fixture 运行它，并断言共享子进程 argv 的首项就是该平台包的原生可执行文件。Loader 组合证明安装该 Bundle 只会注册休眠的 Claude Code provider，不会启动产品进程。

如果安装时省略 optional dependencies、当前平台不受支持，或所选载荷缺失，提供方注册仍保持休眠，但第一次委派会在 SDK 启动边界失败。调用方只会收到安全的 `query-start` / `unknown` 失败事实；原生载荷错误只保留在内部 cause 链和提供方 Host 日志中。提供方既不会探测宿主 CLI，也不会用它重试。

Loader 组合证明 Bundle 默认实例、两个额外命名 Claude 实例与现有 Codex 包可以共存，而且不会启动任一产品。

限定于项目所有者身份的分发授权涵盖官方 SDK 及每个 SDK 版本声明的官方 CLI／平台载荷。[`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md) 会披露当前可选载荷闭包，但不会认定其中声明的条款属于宽松许可；其他无关的非宽松运行时依赖仍会使第三方声明门禁失败。

## 模型体验

### 子级请求

#### 模型看到的内容

Claude Code 子级会在一个全新的 SDK query 中接收独立文本任务。它的工作区是父会话 cwd；其模型、系统指令、工具、沙箱和身份验证来自原生 Claude 设置，所选提供方实例的 Profile 配置会固定该 query 的环境与非交互权限模式，而可执行版本来自 Bundle 锁定的 SDK 平台载荷。

#### 对 token 的影响

子级需为独立的 Claude Code 上下文和 query 承担 token 开销。子级 token 不会进入父级上下文。

#### 对 KV Cache 的影响

这与父请求缓存相互独立。能否复用只取决于 Claude Code 自身的模型、指令、工具、原生设置和全新 query。

### 父级调度与结果（间接）

#### 模型看到的内容

通过 `dsh-tool-subagent`，前台调用会让父级模型看到符合严格成功条件的 Claude Code 最终答案；若结果未完成，错误中会包含终止原因和可选的安全诊断。该诊断可以区分固定 SDK 错误类别、生命周期阶段和已观测的进程结果，而不复制原始产品文本。后台调用会先返回 Job id；随后通用作业控制面会送达完成通知，通过 `job_output` 公开同一最终答案或失败状态 detail，并允许 `job_kill` 请求取消。Claude Code 的推理、工具活动、中间消息、stderr、工作区差异、用量信息、产品标识符、工具输入和原始协议载荷均不会复制到父会话。

#### 对 token 的影响

前台输入会增加工具结果中保留的最终答案或错误内容。后台输入还会包含启动确认、完成通知，以及 `job_output`、`job_kill` 或后续状态结果；子任务 token 仍不会进入父级上下文。本提供方自身不添加父级工具 schema。

#### 对 KV Cache 的影响

仅追加：前台会在可复用的父请求前缀后增加一个结果，后台则会继续追加 Job 启动确认、通知以及后续控制或收集结果。后台调度可能增加一个由通知唤醒的轮次，但这些消息都不会改写更早的前缀。

## 已知限制与后续工作

- **每次运行均新建一个 query 和一个进程**：不支持续接、恢复、池化、进度流或产品会话持久化。
- **静态选择实例**：Profile 配置项固定提供方名称与工具绑定；调用无法动态选择提供方，而且每个公开工具都需要唯一的 `toolName`。
- **宿主设置有意保持权威**：项目和用户设置可以改变模型、工具与行为；本提供方不提供经过筛选或与宿主环境隔离的生产模式。
- **身份验证与账户状态仍由原生机制管理**：Bundle 会提供 CLI，但不会创建账户、登录或改写 Claude 设置；配置与身份验证失败会公开其生命周期阶段与安全的 `unknown` 回退，而不会增加单独的公开分类。
- **委派时必须存在 SDK 平台载荷**：省略 optional dependencies 的安装、不受支持的平台以及缺失或损坏的载荷都会在第一次 query 时失败；不会回退到宿主 CLI。
- **没有人工交互路径**：`AskUserQuestion` 被禁用，权限提示会被拒绝，MCP elicitation 会被拒绝，阻塞对话会快速失败而不会挂起。
- **assistant 载荷仅包含最终文本**：失败运行可以额外公开独立的安全诊断；推理、中间消息、工具通信、用量信息、stderr 和工作区差异仍只保留在产品内部，通用 Job id、通知与状态来自共享作业运行时。
- **没有可选的共享能力**：对于本提供方，共享服务会拒绝输出 schema、子任务角色设定、工具筛选和 harness 深度强制约束。
- **没有按实际经过时间触发的超时或副作用回滚**：长时间运行的工作由调用方取消，且取消前已更改的文件或外部系统不会恢复原状。
