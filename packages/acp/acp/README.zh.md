# @deepseek-ai/dsh-acp

[English](README.md) | 中文

通过 JSON-RPC stdio 提供的仅面向自动化的 [ACP（Agent Client Protocol）](https://agentclientprotocol.com) 服务器。程序化客户端可以创建新 harness agent（智能体）、发送文本提示词、收集已提交的 assistant 文本、按策略响应一次性权限请求并取消工作。仓库中的主要客户端是 [`dsh-subagent-acp`](../../subagent/subagent-acp/README.md)。

此包是传输适配器，而非 UI 集成或能力 seam。它不公开编辑器导航、transcript（文本记录）回放、命令、模式、配置选择器、信息征集、推理（reasoning）、计划、标题或工具展示。交互式渲染与向用户提问属于 Web 宿主和客户端模块。

## 插件

`apply(ctx, config)` 在 stdin/stdout 上打开 `AgentSideConnection` 并驱动 `ctx.agents`。Stdout 专用于协议帧。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `provider` | 无 | 每个已创建 agent 的初始提供方路由。 |
| `model` | 无 | 每个已创建 agent 的初始模型。 |

两个字段都是可选的，以便由另一个 agent/request 监听器提供目标。可运行的 ACP 组合同时要求两者。

## 协议约定

| 方法 | 行为 |
|---|---|
| `initialize` | 协商受支持的版本，并仅公布基线提示词（无图像、音频或嵌入上下文能力）。不公布会话、编辑器、终端、文件系统或 MCP 能力。 |
| `authenticate` | 空操作，因为服务器不公布身份验证方法。 |
| `session/new` | 以绝对路径作为主 `cwd` 创建新 agent；接受空的 `additionalDirectories` 和 `mcpServers`，拒绝非空值。 |
| `session/prompt` | 拼接文本块，将基线资源链接渲染为带方括号的文本引用，拒绝空输入或超出基线的输入，每个会话只允许一个正在处理的请求，并等待整个 agent 进入空闲状态。正常完全停稳时报告 `end_turn`；显式 ACP 取消、资源释放，或准入被丢弃的提示词（无轮次槽位）时报告 `cancelled`。 |
| `session/cancel` | 仅取消指定的 agent，并将其待处理提示词结算为 `cancelled`；未知 id 为空操作。 |
| `session/update` | 为每个非空文本块发出一个 `agent_message_chunk`；这些文本块来自已提交的 `assistant/message`。省略原始增量和非消息事件。 |
| `session/request_permission` | 为携带工具调用 id、由桥接层拥有的批准请求提供一次性允许／拒绝选项。客户端可以自动回答。 |

一个连接可以拥有多个会话。桥接层以带品牌的会话 id 作为记录键，并在路由事件或权限请求前检查 agent 是否为同一对象。每个会话都有独立的提示词槽位、工作区、取消路径和资源释放器。

已提交消息输出有意牺牲逐 token 输出的低延迟，以换取干净的自动化结果。未提交的提供方分片和重试尝试无法泄漏部分文本；推理与工具活动仍保留在会话日志中，以便其他界面观测。

## 生命周期

客户端断开与 Cordis 释放共用同一个记忆化清理流程。桥接层先拒绝新会话和提示词，结算待处理提示词，然后只 drain 此连接确切拥有的 Agent 之下的可继续后代，再并行释放这些 handle，并等待全部结果结算后才报告失败。其他共享该上下文的前端会保留其可继续森林和准入。因此，仅 ACP 的插件重载不会遗留 agent。

ACP 要求每个提示词响应都携带 `stopReason`，但桥接层不声称它表示提示词专属的轮次结果。已提交的 assistant 消息会在整个自有活动期间流式输出，agent 进入空闲状态前发生的 steering（中途引导）或注入工作也可能参与其中。因此，因 token 上限而结束的轮次不会成为提示词级 ACP 停止原因（它们以 `end_turn` 结算）；关联轮次上的模型错误会立即拒绝该提示词。

## 运行

`pnpm --dir /path/to/deepseek-harness run demo:acp` 启动仓库的自动化服务器组合。父 harness 可以通过 [`@deepseek-ai/dsh-subagent-acp`](../../subagent/subagent-acp/README.md) spawn 它；其他 ACP 客户端只需上述核心方法。

## 模型体验

### 提示词文本

#### 模型看到的内容

`session/prompt` 文本块会原样拼接为一条用户消息；基线资源链接会在该消息中表示为带方括号的 `[resource_link name=… uri=…]` 引用，模型可以使用自身工具打开它。协议元数据、客户端能力、权限选择和会话 id 绝不进入模型请求。

#### Token 影响

提示词 token 取决于数据，并保留在该会话的历史中直到上下文压缩（context compaction）。并发 ACP 会话保留独立上下文。

#### KV Cache 影响

仅追加；新用户消息位于可复用请求前缀之后，不会使先前缓存条目失效。

### 权限决策

#### 模型看到的内容

不会直接看到任何内容。所属工具通过常规工具结果路径记录其结果：允许、拒绝、取消或不可用。

#### Token 影响

只有所属工具的结果会贡献 token。

#### KV Cache 影响

仅通过所属工具的结果追加。

## 已知限制与暂缓事项

- **仅新会话**：不支持加载、列出、恢复、删除和 fork。
- **仅基线提示词和一个 workspace**：图像、音频、嵌入资源、非空附加目录和 MCP 服务器都会被拒绝；资源链接只会展平为文本引用，不会获取其内容。
- **仅已提交答案**：实时进度、推理、工具活动、计划、标题和用量不会通过协议传输。
- **由连接管理的生命周期**：一个连接会释放其所有会话；尚未实现单个会话关闭功能。
