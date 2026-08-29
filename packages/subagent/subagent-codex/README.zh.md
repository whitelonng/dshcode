# @deepseek-ai/dsh-subagent-codex

[English](README.md) | 中文

本包注册由 Profile 命名、默认名称为 `codex` 的 Codex subagent 提供方。每次接受运行请求后，它都会在发起委托的会话工作区中使用 `app-server --stdio` 启动官方包内 Codex wrapper，创建一个临时 Codex 线程，提交一个自包含的文本任务，并通过共享的 [`dsh-subagent`](../subagent/README.zh.md) 结果约定返回选定的最终答案或独立的安全失败诊断。

## 启动与所有权

`start(request)` 只接受非空的文本块序列，并根据父会话确定子级 cwd。随后，它通过 [`dsh-subprocess`](../../subprocess/subprocess/README.zh.md) spawn 固定命令，依次执行 `initialize` → `initialized`，把 Profile 选择的模式映射为官方 `thread/start` approval／reviewer／sandbox 字段并与 `{ cwd, ephemeral: true }` 一起发送，且仅在 Codex 返回有效的临时线程后才发布此次运行。若在发布前发生失败或取消，它会关闭通信链路、终止受管进程树并等待其退出，然后拒绝 `start()` 调用。非取消拒绝只公开固定的 `initialize` 或 `thread-start` 阶段及已经观测到的进程结果；原始产品与 Host 错误只保留在内部 cause 链中。

已发布的 `run.result` 恰好启动一个轮次。它只接受与此次运行的线程和轮次匹配的通知，随后等待权威的终止通知 `turn/completed`。以最后一条 `phase: "final_answer"` 的 `agentMessage` 为准；若 Codex 没有发出明确的最终阶段，则以最后一条 `phase: null` 的消息作为兼容性回退。过程说明绝不会取代上述任一答案；成功完成的轮次若没有非空白答案，结果也会判为错误。

对于命令与文件审批，无人值守的提供方会从请求给出的决策选项中选择一项不予批准的决策，并优先选择 `cancel`；稳定的 0.147.0 请求形态没有决策选项列表，因此回退到 `decline`。它对权限请求返回作用域限于当前轮次的空权限集，不向用户输入请求提供任何答案，并拒绝 MCP elicitation。若请求在无人值守模式下没有合法响应，或是未知服务器请求，此次运行就会失败。wire 只记录有效模式、请求类别、决定与固定的安全原因，也会识别被拒绝的命令／文件 item 和 `sandboxError` 终态。Codex 0.147.0 的部分早期 `never` 拒绝和 sandbox violation 只写入结构化 stderr，因此提供方会 pipe stderr、原样转发给 Host，并在每次运行的有界尾缓冲中匹配两个固定签名；原始 stderr 不会进入诊断。

本地取消会在结果竞态中胜出并映射为 `aborted`。对于失败轮次，诊断会保留 Codex 0.147.0 `codexErrorInfo` 联合中的全部十一种字符串与五种对象 variant；四种连接／stream variant 会在上游提供时保留数值 `httpStatusCode`，而 `activeTurnNotSteerable` 不公开 `turnKind`。诊断还会注明 `turn-start`、`turn` 或 `process`，分别包含可用的退出码与信号，并对无法识别或格式错误的值使用 `unknown`，且不复制原始字段。`contextWindowExceeded` 仍映射为 `max-tokens`；其他任何远端中断或失败仍映射为 `error`，且该提供方不会产生 `refusal`。参与失败的权限决定会跟在结构化失败行之后。成功与本地取消都不附带这两类事实。

`dispose()`（资源释放）具有幂等性：如果当前的两个标识符均已知，它会尽力请求 `turn/interrupt`，关闭 JSON-RPC 通信链路，结束标准输入，调用共享的进程树逐级终止机制，等待整棵进程树退出，并移除 stderr observer。独立清理拒绝使用固定的 `teardown` 阶段与可用进程结果。当启动与回滚同时失败时，顶层聚合消息会保留两条安全阶段说明，而原始失败仍只在内部可见。

## 能力与上下文

本提供方不声明任何可选的启动时能力，并报告 `inheritsParentContext: false`。Codex 会接收独立文本任务和父会话 cwd，但不会接收父会话的对话、角色设定、工具筛选器、深度策略或结构化输出约定。临时 Codex 线程 ID 与轮次 ID 仅在此次运行内部可见，绝不会持久化到父会话。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `codex` | `ctx.subagents` 中的非空注册名称；每个已挂载实例都需要唯一值。 |
| `env` | `{}` | 显式指定的子进程环境，叠加在由子进程 seam 清除凭证后的父环境之上。 |
| `permissionMode` | `never` | 为该提供方实例的每个线程固定原生非交互审批与沙箱模式。 |
| `disposeGraceMs` | `3000` | 共享进程树责任方各终止层级之间的宽限期，单位为毫秒且须为正有限值，并不得大于仓库共享的 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.zh.md)；随后资源释放会等待整棵进程树退出。 |

| `permissionMode` 值 | `thread/start` 字段 | 原生行为 |
|---|---|---|
| `never` | `approvalPolicy: never`；省略 sandbox | 永不请求审批；执行失败会在原生 sandbox 下返回模型。 |
| `approve-for-me` | `approvalPolicy: on-request`、`approvalsReviewer: auto_review`、`sandbox: workspace-write` | 由 Codex 自动评审权限请求，不等待人工。 |
| `dangerously-bypass-approvals-and-sandbox` | `approvalPolicy: never`、`sandbox: danger-full-access` | 跳过审批与 sandbox；必须显式选择该值。 |

生产环境会解析锁定的 `@openai/codex@0.147.0` 依赖所声明的 `codex` bin，并使用当前 Node 可执行文件启动该 JavaScript wrapper。Wrapper 会选择匹配的原生平台载荷；提供方既不检查也不回退 `PATH` 中的宿主 `codex`。父会话 cwd、`HOME` 与 `CODEX_HOME` 继续让原生 Codex 配置和身份验证保持权威，而提供方只覆盖选定线程的 approval／reviewer／sandbox 字段。其他项目、模型、provider、MCP、hook、skill 与账户设置仍由原生机制负责。本插件不选择模型、不创建 `CODEX_HOME`、不执行登录，也不探测账户。子进程 seam 会先移除具有凭证特征的环境变量，再应用显式 `env` 覆盖。

本包是可选的 Profile Bundle。将它安装进目标 Profile 后重启该 Profile；安装会把官方 wrapper 与一个兼容的原生平台载荷带入该 Profile，而包所声明的 `cordis.patch.yml` 层只注册休眠的 `codex` Host provider，不会启动 Codex 进程。移除该包后，下一次 Profile 启动会撤回这一 provider 及其私有运行时闭包。

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-codex
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-codex
dsh --profile <name>
```

安装决定 Host 可用性，而不是模型权限。Bundle 会提供休眠的默认 `codex` 配置项；Profile 可以替换该配置项的完整 config，也可以挂载更多具有不同 `providerName`、`permissionMode` 与 `env` 的配置项。加载实例本身不会在绑定工具调用前启动 Codex 进程。每个 `dsh-tool-subagent` 配置项指定一个提供方，并需要独立的 `toolName`，因此模型看到的是静态工具，而不是动态提供方选择器。完整 Agent Preset 携带对应的默认产品工具行并设置 `disabled: true`；复制一个 preset 后删除该字段，即可只向由该副本组装的 agent 暴露 `subagent_codex`。其 `one-shot` 策略会让省略 `run_in_background` 或传入 `false` 的调用继续在前台等待，而显式传入 `true` 会返回由父 agent 拥有的 Job ID，供 `job_output` 或 `job_kill` 使用。base host（基础宿主）与完整 preset 已提供通用作业注册表和控制工具。

下列独立组装展示完整的显式能力。基于 `@deepseek-ai/dsh-base` 的 Profile 保留已有 Job 配置项，新增产品提供方与工具配置项，而且不重复挂载 Job 服务。

```yaml
- id: subagent-codex-safe
  name: '@deepseek-ai/dsh-subagent-codex'
  config:
    providerName: codex-safe
    permissionMode: never
    env:
      OPENAI_API_KEY: !!js process.env.OPENAI_API_KEY

- id: subagent-codex-bypass
  name: '@deepseek-ai/dsh-subagent-codex'
  config:
    providerName: codex-bypass
    permissionMode: dangerously-bypass-approvals-and-sandbox
    env:
      OPENAI_API_KEY: !!js process.env.OPENAI_API_KEY
```

```yaml
- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

- id: tool-subagent-codex-safe
  name: '@deepseek-ai/dsh-tool-subagent'
  disabled: true
  config:
    provider: codex-safe
    toolName: subagent_codex_safe
    backgroundMode: one-shot
    maxDepth: provider-managed

- id: tool-subagent-codex-bypass
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: codex-bypass
    toolName: subagent_codex_bypass
    backgroundMode: one-shot
    maxDepth: provider-managed
```

## 产品兼容性与证据

生产环境的协议层有意只实现这一单次执行约定所需的 app-server 方法。运行时依赖与六个 optional-dependency alias 均锁定到 `@openai/codex@0.147.0` / `codex-cli 0.147.0`。普通安装会按当前操作系统与 CPU 选择一个载荷。对于当前 darwin-arm64 载荷，`npm pack --dry-run --json @openai/codex@0.147.0-darwin-arm64` 报告压缩包为 111,199,052 字节、解包后为 274,777,843 字节。该包包含原生 `codex`、`codex-code-mode-host`、`rg` 与 `zsh` 资源；其他平台可能不同，这些数值只用于披露而不是安装阈值。

生成的 schema 证据与包测试会固定全部十六种 error-info variant、HTTP status 所在位置、六个生命周期阶段、进程结果、终止原因映射、unknown 回退、脱敏、权限顺序、取消、并发与清理聚合。无密钥真实产品测试会驱动包内 wrapper 连接回环 Responses fixture，并观测包内 argv、确切的 Bearer 密钥、原始任务、逐字节完全一致的最终回答、线程级 `never` 对环境中 `on-request` 的覆盖、自动评审启动、不产生文件副作用的无人值守拒绝、真实 `internalServerError`、测试拥有临时存储中的显式危险绕过写入、携带安全退出事实的进程／协议失败，以及 wrapper／原生进程完全停稳。同一层级还会证明两个命名实例保留彼此独立的环境与原生模式。

如果安装时省略 optional dependencies、当前平台不受支持，或所选载荷缺失，第一次委派会在 `initialize` 阶段以安全 `unknown` 类别和已观测到的进程结果失败。原始 wrapper 文本只保留在 Host stderr；提供方既不会探测宿主 CLI，也不会用它重试。独立 wrapper fixture 会另行证明原生载荷失败与不存在宿主回退。

## 模型体验

### 子级请求

#### 模型看到的内容

Codex 子级会在一个全新的临时线程中，以单个轮次接收这些独立文本块。它的工作区是父会话 cwd；其模型、系统指令、工具和身份验证来自原生 Codex 配置，所选提供方实例的 Profile 配置会固定该线程的环境、非交互审批策略与沙箱模式，而可执行版本来自 Bundle 锁定的平台载荷。

#### 对 token 的影响

子级需为独立的 Codex 上下文和轮次承担 token 开销。子级 token 不会进入父级上下文。

#### 对 KV Cache 的影响

这与父请求缓存相互独立。能否复用只取决于 Codex 自身的提供方、模型、指令、工具和临时线程请求。

### 父级调度与结果（间接）

#### 模型看到的内容

通过 `dsh-tool-subagent`，前台调用会让父级模型看到选定的 Codex 最终答案；若结果未完成，错误中会包含终止原因和可选的安全诊断。该诊断可以区分固定 error-info 类别、协议阶段、数值 HTTP status 和已观测的进程结果，而不复制产品正文。后台调用会先返回 Job id；随后通用作业控制面会送达完成通知，通过 `job_output` 公开同一最终答案或失败状态 detail，并允许 `job_kill` 请求取消。Codex 的过程说明、推理（reasoning）、工具活动、原始 stderr、工作区差异、用量信息、产品标识符、命令、路径和协议载荷均不会复制到父会话。

#### 对 token 的影响

前台输入会增加工具结果中保留的最终答案或错误内容。后台输入还会包含启动确认、完成通知，以及 `job_output`、`job_kill` 或后续状态结果；子任务 token 仍不会进入父级上下文。本提供方自身不添加父级工具 schema。

#### 对 KV Cache 的影响

仅追加：前台会在可复用的父请求前缀后增加一个结果，后台则会继续追加 Job 启动确认、通知以及后续控制或收集结果。后台调度可能增加一个由通知唤醒的轮次，但这些消息都不会改写更早的前缀。

## 已知限制与后续工作

- **每次运行均新建一个进程、一个线程和一个轮次**：不支持续接、恢复、池化、进度流或产品会话持久化。
- **静态选择实例**：Profile 配置项固定提供方名称与工具绑定；调用无法动态选择提供方，而且每个公开工具都需要唯一的 `toolName`。
- **身份验证与账户状态仍由原生机制管理**：Bundle 会提供 CLI，但不会创建账户、登录、信任项目或改写 Codex 设置；配置与身份验证失败会公开其生命周期阶段与安全的 `unknown` 回退，而不会增加单独的公开分类体系。
- **委派时必须存在原生平台载荷**：省略 optional dependencies 的安装、不受支持的平台以及缺失或损坏的载荷都会在第一次运行时失败；不会回退到宿主 CLI。
- **兼容性由开发证据锁定**：若要从已验证的 0.147.0 协议基线升级，必须重新生成上游 schema 证据，并重新运行握手、答案选择、审批、取消、无密钥真实产品以及带密钥的 DeepSeek 随机数测试。
- **没有人工审批路径**：已知的无人值守审批请求会被拒绝，未知服务器请求会以默认拒绝方式使运行失败；三种 Profile 模式都不会创建 DSH 交互通道或逐次调用 allow 策略。
- **assistant 载荷仅包含最终文本**：失败运行可以额外公开独立的安全诊断；推理、过程说明、中间消息、工具通信、用量信息、原始 stderr 和工作区差异不会进入父会话，通用 Job id、通知与状态来自共享作业运行时。
- **没有可选的共享能力**：对于本提供方，共享服务会拒绝输出 schema、子任务角色设定、工具筛选和 harness 深度强制约束。
- **没有按实际经过时间触发的超时或副作用回滚**：长时间运行的工作由调用方取消，且取消前已更改的文件或外部系统不会恢复原状。
