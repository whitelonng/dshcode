# @deepseek-ai/dsh-llm-deepseek

[English](README.md) | 中文

harness LLM（大语言模型）seam 的 DeepSeek chat-completions 适配器：直接 `fetch` + SSE（Server-Sent Events，由 `eventsource-parser` 分帧），将官方协议格式（wire format；真源：API 文档 guides/thinking_mode、guides/tool_calls、api/create-chat-completion）转换为 `StreamChunk` 协议。

同一 seam 的第二个基于库的实现位于 `@deepseek-ai/dsh-llm-pi-ai`。本包拥有 `deepseek-official` 提供方路由——刻意区别于 pi-ai 的 catalog 名称 `deepseek`，因此同一组合可以并排挂载两条 DeepSeek 路径；而为 `deepseek-official` 本身注册另一个适配器仍会抛出 `LlmError('DUPLICATE_ADAPTER')`。

包根入口导出 Cordis 插件约定与 `DeepSeekAdapter`；协议序列化、SSE 解析与分片转换 helper 不属于该根约定。

## 配置

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY  # default; resolved per request via ctx.credentials, then the environment
    baseURL: https://api.deepseek.com # optional; $DEEPSEEK_BASE_URL then the public API when omitted
    thinking: enabled        # optional; provider default is enabled
    reasoningEffort: high    # optional; off | low | high | max — omitted ⇒ high
    maxTokens: 256000        # optional positive per-request output cap; this is the default
    streamIdleTimeoutMs: 300000 # optional; positive finite Node timer delay; five-minute default
    maxRequestFilesBytes: 134217728 # optional positive integer; 128 MiB raw request-image default
    maxInlineRequestImageBytes: 20971520 # base64 fallback high watermark; 20 MiB default
    maxImagesPerRequest: 600       # provider request image-count limit
    imageOffloadByteQuantum: 67108864 # oldest-image removal advances in 64 MiB steps
    inlineImageOffloadByteQuantum: 10485760 # fallback removal advances in 10 MiB steps
    imageOffloadCountQuantum: 20      # count overflow advances in 20-image steps
    filesApiTimeoutMs: 60000           # per-image Files resolution deadline; one-minute default
    fileExpiresAfterSeconds: 604800   # uploaded image lifetime; 1 hour to 30 days
    fileRefreshMarginSeconds: 3600    # replace ids with less lifetime remaining
    fileQuotaCleanupBatch: 100        # oldest harness-owned files deleted before one quota retry
    retryPolicy:             # optional; omission uses normal mode with five retries
      mode: always           # normal | always
      backoff:
        initialDelayMs: 500
        maxDelayMs: 10000
        jitterRatio: 0.1
    defaultContextWindow: 1000000 # optional positive-integer fallback; this is the default
    models:                  # optional; defaults to V4 Flash, V4 Pro, and V4 Flash Vision Exp
      - id: deepseek-v4-flash
        name: DeepSeek-V4-Flash
      - id: deepseek-v4-flash-vision-exp
        name: DeepSeek-V4-Flash-Vision-Exp
        inputModalities: [text, image]
        imagePixelBudget: 640000
        imageMaxBytes: 1048576
      - id: private-reasoner
        description: Company-hosted reasoning model
        contextWindow: 512000
```

该插件注册唯一提供方路由 `deepseek-official`，并一同注册解析后的 `retryPolicy`；省略时会解析为 normal 模式并重试五次。请求使用 `provider: deepseek-official` 选择该路由；其 `model` 会作为协议 `model` 字符串原样传递，因此更改 DeepSeek 模型不需要生命周期时注册。省略 `models` 会公布 `deepseek-v4-flash`、`deepseek-v4-pro` 与支持图片输入的 `deepseek-v4-flash-vision-exp`，三者的上下文窗口均为 1,000,000 token；显式列表会替换这些默认值，`models: []` 则不公布任何模型。Catalog 配置项通过 `ctx.llm.listModels('deepseek-official')` 公开给 ACP（Agent Client Protocol）编辑器和 Web 选择器等客户端，但仍只提供建议：未列出模型 id 仍原样传递，并按纯文本路由处理。省略配置项 name 默认为其 id，省略 `inputModalities` 则表示仅支持 `text`。

支持图片的 catalog 配置项声明 `inputModalities: [text, image]`，并可设置 `imagePixelBudget`、`imageMaxBytes` 或 `imageDetail: low`。普通默认值为总像素 640,000、编码字节 1MiB；low detail 的默认总像素为 512×512。附件存储按 `min(1, sqrt(pixelBudget / (width * height)))` 缩放，并向预算内取整，确保总像素不超过硬上限。因此 2048×1024 规范化附件会得到约 1130×565 的请求版本，而不会被强制变成正方形。请求编码按需执行：低色数图片先尝试 PNG，只有不带 alpha 通道时才使用 palette，再尝试质量 85 和 80 的 WebP；其他透明图片依次尝试质量 85 和 80 的 WebP；其他非透明图片依次尝试质量 85 和 80 的 JPEG。两个质量档均超过 1MiB 时才缩小尺寸。同一 `variantId` 的并发生成共享一次变换。调用方可以单独取消等待，不会中断其他等待方；没有等待方时才会停止变换。适配器通常通过 `POST /files` 上传确切的派生请求字节，再发送 `{type: "file", file_id}` 块。File ID 解析失败或超时后，适配器会用相同请求版本的 base64 data URL 重新组装整个 chat 请求；同一请求不会混用 file ID 和内联图片。每张保留图片前都有稳定文本，写明完整附件 ID 和实际请求尺寸。User、工具结果、agent loop、压缩和直接 `ctx.llm.stream` 请求都使用该投影。纯文本路由会收到稳定的附件占位文本，持久历史继续保留图片引用。

`maxRequestFilesBytes` 和 `maxImagesPerRequest` 限制请求中保留的请求版本，默认值分别为 128MiB 和 600 张。字节和数量步长不得超过对应上限。读取附件前，适配器以路由的请求版本字节上限作为保守上界，移除超预算的最旧前缀，只读取并转换保留的规范化附件。系统随后用确切派生长度再次检查，但不会重新加入已省略图片。字节数越过上限时，被移除的最旧前缀会越过下一个 64MiB 边界。由 1MiB 图片组成的历史达到 129MiB 时会移除最旧的 65 张并保留 64MiB；直到持久历史超过 192MiB，这个前缀才再次变化。图片数量超限时则按 `imageOffloadCountQuantum` 独立递增。移除的图片会变成固定模型可见占位文本 `[image omitted to keep the request within its image limit; older images are omitted first. If this image is still needed, read its file again when a path is available; otherwise ask the user to attach it again.]`。这种定量投影不会因每新增一张图片就改写较早的请求前缀。

内联回退使用独立的 base64 预算。`maxInlineRequestImageBytes` 默认为 20MiB，`inlineImageOffloadByteQuantum` 默认为 10MiB，因此由 21 个 1MiB base64 负载组成的历史会移除最旧的 11 个并保留 10MiB。计算使用 base64 膨胀后的长度。系统逐字节复用已经准备好的请求版本；回退不会再次解码或压缩图片。前面图片已经成功写入的上传映射会保留，供后续请求复用。

上传 ID 按端点和 API key 作用域以及请求 `variantId` 记录在 `DSH_HOME` 下。变体身份覆盖规范化附件 ID、变换策略版本、路由像素和字节预算及编码参数，因此 Files API 和内联回退引用同一份确定性字节。上传默认请求 7 天有效期，并保存服务端返回的 `expires_at`。本地映射剩余时间不超过一小时时会在使用前替换；适配器不会在每次 chat 前查询远端文件。如果 chat 报告文件 ID 已过期、删除、缺失或无效，并指出本次请求使用的一个或多个 ID，适配器只删除这些映射。如果响应只说明文件状态失效而没有指出 ID，适配器会删除该次 chat 使用的全部文件映射。随后重新上传受影响的请求版本，并重试一次 chat。第二次 chat 仍报告文件失效时，适配器会按该响应清理映射并返回错误，不会发起第三次 chat。上传响应若没有完整文件对象、匹配的字节数和 `expires_at`，就不会写入索引；后续请求会再次上传，而不是信任不一致的本地状态。本地上传索引格式损坏时按空缓存处理，并由下一次成功上传替换。文件解析包括本地索引访问和远端上传，默认每张图片的时限为一分钟。默认的 stream idle 时限为五分钟，因此通常有时间执行内联回退；部署可以设置更短的 stream idle 时限，让外层时限先终止请求。每次成功解析都会刷新外层 idle watchdog。任何解析失败都会把该请求切换到内联模式；显式公共文件管理操作仍会报告自身错误。

同一作用域和 `variantId` 的并发解析共享一次 Files 上传，每个等待方可以单独取消。一次上传配额错误会先分页收集配置数量的最旧 `dsh-` 文件，再删除这些文件并重试一次上传。`DeepSeekFilesClient.delete`、`DeepSeekFileStore.release` 和 `releaseAll` 提供主动远端空间回收。本包记录的当前提供方限制为 Files 单次上传 128MiB、chat 单图引用 32MiB、每个 API key 最多 10,000 个文件和 25GiB；默认 1MiB 请求版本低于两个单文件上限。

`contextWindow` 对每个已配置模型都可选，不会通过建议 catalog 公开。`ctx.llm.resolveModelInfo('deepseek-official', model).context` 先返回精确模型值，再对不含容量的配置项或未列出原样传递 id 返回 `defaultContextWindow`。适配器默认值为 1,000,000；因此，压力敏感插件可以获得由部署决定的容量，不会将模型 selector 视为权威。为 `deepseek-official` 注册另一个适配器会抛出 `LlmError('DUPLICATE_ADAPTER')`。

`maxTokens` 是适配器为对话请求配置的输出上限，默认值为 256,000。Catalog 配置项可以自带 `maxTokens`，它对该模型胜出；不含该上限的配置项以及任何未列出原样传递 id 都解析为 profile 值，因此新增按模型的上限只改变一个模型，而非整条路由。确切模型解析会将胜出值公开为 `defaultMaxTokens`；`LlmRuntime` 会在 agent loop（智能体循环）写入 `request/header` 前，将该值填入 `GenerateOptions.maxTokens`，从而仍可根据持久记录重建协议请求。显式的请求值或 `AgentOptions.maxTokens` 值优先，并会序列化为 `max_tokens`。适配器不会根据 `contextWindow` 自动调低该请求预算；上下文或提供方输出上限较小的部署必须配置与其相容的 `maxTokens`。

同一确切模型结果会在部署策略允许思考时，为每个原样传递模型在 `reasoning` 下公开有序的 `off`、`low`、`high` 和 `max` 推理（reasoning）强度。`reasoningEffort` 选择部署默认值，省略时回退为 `high`。`agent/request` 可以在每个会话步骤替换它；解析后的值会记录在 `request/header`。`low`、`high` 和 `max` 会启用思考，并以同名值序列化为官方顶层 `reasoning_effort`；适配器持有的 `off` 则序列化为 `thinking.type: disabled`，且省略 `reasoning_effort`。不支持的值会在网络 I/O 前以 `UNSUPPORTED_REASONING_EFFORT` 失败。

`thinking: disabled` 是部署锁定：它只公布 `off`，并以 `off` 为默认值。省略 `reasoningEffort` 或将其配置为 `off` 均有效；配置 `low`、`high` 或 `max` 会使插件加载失败，直接按请求启用思考也会在网络 I/O 前失败。携带 `GenerateOptions.purpose: 'session-title'` 的请求也会强制禁用思考并省略已解析的推理强度，将有界输出保留给可见标题文本，不改变会话或压缩（compaction）默认值。

`streamIdleTimeoutMs` 会限制每次未完成提供方读取，包括初始 `fetch`，但不计入消费方在分片间花费的时间。DeepSeek SSE 注释和成功的文件解析会作为传输活动使尚未完成的读取重新计时，但绝不会成为 `StreamChunk` 值或会话日志事件。同一个稳定的 abort 信号会在整个调用期间传递给请求与 body reader；过期会停止传输并抛出 `LlmError('TIMEOUT')`，较早的调用方 abort 则抛出 `LlmError('ABORTED')`。适配器通常每次 `stream()` 调用发起一次 chat 请求，只有失效文件恢复会发起第二次。首次 chat 前的文件解析失败会发送一次内联请求。如果失效文件响应后的替换解析失败，该内联请求就是唯一允许的重试。适配器把已配置重试策略注册为提供方元数据，再由 `dsh-llm-retry` 在持久化的 agent（智能体）步骤边界单独执行该策略。

## 动态配置（settings + credentials）

连接事实不在加载时冻结。`resolveAdapterOptions` 是从原始配置到已校验事实的唯一显式 resolve 步骤，适配器经由一个 thunk **每操作重读一次**：base URL、catalog、请求默认值、图片和 Files 策略与 idle 预算都在下一次请求生效，进行中的流则保持其起始事实。三个可选 seam 供给该 thunk：

- **`ctx.settings`**——插件用同一份 `Config` schema 注册 `llm-deepseek` namespace，并以其 `cordis.yml` 条目为组合 `base`，因此用户设置文档中的 `llm-deepseek:` 分节可以免重启覆盖任何字段。未挂载 settings 服务时，仅由 entry 配置驱动适配器，行为不变。存活 settings 快照若通过 schema 却违反 schema 之外的约束（重复的 catalog id、无法成立的 thinking／推理强度组合），则保留最后可用事实并记录失败；entry 配置本身仍会使插件加载失败。
- **`ctx.credentials`**——API 密钥按每次 stream 调用解析，取自与端点*同一*份解析后的快照。配置只携带 `apiKeyEnv`，从不携带字面密钥：该引用经凭据 seam 解析，未挂载 seam 时则经受信环境层解析。由于凭据事实与连接事实同行，被 resolver 拒绝的 settings 快照既不贡献自己的端点，也不贡献自己的密钥：整个先前世代继续服务。每个解析出的密钥在使用前都会被校验格式，因此 HTTP 标头无法承载的值会以 `LlmError('INVALID_CREDENTIAL')` 被拒绝，点名失败的入口，但绝不透露密钥的任何部分，而不是以语义不明的 `fetch` `TypeError` 形式浮现。任何地方都没有密钥的请求以 `MISSING_CREDENTIAL` 失败，并点名每个配置入口，同时路由保持注册、catalog 保持可浏览——首次运行的上手流程就是「浏览模型、存入密钥、再次发起提示」，中间无需任何重启。
- **`ctx.attachments`**——图片请求会在请求时解析该服务，因此 Cordis 加载顺序不会冻结可选图片能力。服务缺失时，图片输入以 `UNSUPPORTED_CONTENT` 失败；纯文本调用不依赖该服务。

唯一在注册期捕获的事实是重试策略：其解析值变化时，插件原地重新注册该路由（同一适配器实例、一个同步区段），因此 `ctx.llm.providerRetryPolicy('deepseek-official')` 始终报告当前策略。

该插件还会在可配置提供方目录（`ctx.llm.listConfigurableProviders()`）中声明自己的路由：提供方为 `deepseek-official`，settings namespace 为 `llm-deepseek`，settings path 为空——整个分节就是 profile。配置界面借助该条目，把本适配器与休眠的 pi-ai 提供方一并呈现。

## 应用归因

每个 chat 和 Files API 请求都携带 dsh-llm `attributionHeaders()` 的共享归因标头，即用于识别 harness 的必需 `User-Agent` 基线（见 [dsh-llm § 应用归因](../llm/README.zh.md#app-attribution-attributionts)）。在该适配器约定（adapter contract）下，直接 DeepSeek 请求与 OpenAI 兼容 gateway 请求都不会获得提供方特定应用归因标头；OpenRouter 应用归因暂缓到未来的显式 OpenRouter 适配器或模式。`GenerateOptions.purpose` 为 `compaction` 的请求（dsh-compaction-basic 的辅助摘要调用）还会携带 `x-deepseek-harness-compact: 1`，让宿主可以将压缩流量与会话请求分开。

DeepSeek 请求身份独立于应用归因。凭据解析成功后，每个提供方请求都会通过 `x-deepseek-harness-user-id` 携带来自 [`@deepseek-ai/dsh-anonymous-user-id`](../../identity/anonymous-user-id/README.zh.md) 的稳定匿名 id；携带 `GenerateOptions.sessionId` 的请求还会通过 `x-deepseek-harness-session-id` 发送该确切值，缺少会话的直接调用则省略会话标头。两个标头都会发送至解析后的 `baseURL`（包括已配置的 gateway），且不会进入请求正文或模型可见内容。

## 协议格式说明

- 只支持流式输出（`stream_options.include_usage` 始终开启）。`usage` 可能附着在 finish 分片上，也可能作为尾随的纯 usage 分片到达；转换器会将两者都延迟到 `[DONE]`，因此 `usage` 始终位于 `finish` 之前，`finish` 之后不会出现任何内容。
- 适配器持有的 `off` 推理强度映射为 `thinking: {type: 'disabled'}`，绝不会以 `reasoning_effort: 'off'` 通过协议发送。
- 第一个思考模式分片携带 `reasoning_content: ""`，系统会处理它（不会产生多余 reasoning 块）。
- **推理回传规则**：每个携带推理内容的 assistant 轮次都会将 `reasoning_content` 序列化回历史。思考模式在工具调用轮次上必需它；DeepSeek 在其他轮次上会忽略它，而将该对话重新编码转发给其他厂商的网关，要靠对回传原文取哈希来恢复该轮次上游的思考签名。
- 支持图片的 user 消息会保留文本／图片顺序。Tool role 内容仍为字符串；连续工具结果中的图片会用 `Attached image(s) from tool result:` 汇总到随后一条 user 消息。
- Cache 计量：`cacheReadTokens` ← `prompt_cache_hit_tokens` / `prompt_tokens_details.cached_tokens`；DeepSeek 不报告 cache-write 指标。

## 错误

非 2xx 响应会抛出稳定 code 的 `LlmError`：`AUTH`（401/403）、`QUOTA`（提供方详细信息标识配额、余额或点数耗尽的响应）、`RATE_LIMIT`（其他 429）、`CONTEXT_WINDOW_EXCEEDED`（提供方 code、type 或 message 标识上下文溢出的 400）、`INVALID_REQUEST`（其他 400 和 413）、`SERVER`（5xx），其他情况为 `HTTP_<status>`。其可序列化 `failure` 保留 HTTP 状态，以及有效的正 `Retry-After` 秒数／日期延迟和存在时的 `x-request-id` / `x-deepseek-request-id`。如果 DeepSeek 拒绝一张已规范化图片，主错误会写明附件 ID 或显示名称、持久消息和图片位置、规范化后的媒体类型、8-bit sRGB/sRGBA 位深、尺寸和提供方消息。存在多张候选图片且提供方详细信息没有 file id 时，错误会列出全部可能图片，不会把错误归给第一张。原始响应保留为错误 `cause`，不会成为唯一的用户可见诊断。附件读取会保留稳定的附件失败 code，不会变成传输失败。响应前传输失败（DNS、连接被拒绝、TLS、proxy）会抛出命名已配置端点的 `TRANSPORT`，并将原始拒绝作为 `cause`；调用方 abort 抛出 `ABORTED`，仍以 loop 的取消信号为准。协议违例抛出 `STREAM_CLOSED`（没有 `[DONE]`）或 `MALFORMED_RESPONSE`（JSON payload 格式错误）。未知协议 `finish_reason`（例如 `content_filter`、`insufficient_system_resource`）会变为 `finish {kind: 'error', failure}` 分片；已完成流如果使用 `stop`（或缺失）finish 但没有开启内容块，就会变为 `finish {kind: 'error'}`，code 为 `EMPTY_RESPONSE`（默认策略会重试）。

## 模型体验

### DeepSeek 请求

#### 模型看到的内容

所选 DeepSeek 模型会收到 harness 系统提示词、消息历史、工具 schema、stop sequence 和调用配置。视觉模型通常通过 Files API 引用收到保留的 user 与工具结果图片，旁边带有稳定附件句柄和请求图片尺寸；Files 解析失败时，所有保留图片改用内联 data URL。超出上限的较旧图片由已记录的占位文本表示。之前 assistant 轮次的推理内容会原文回传，无论该轮次是否调用了工具。

#### Token 影响

精确文本与图片 token 输入取决于提供方 tokenization。推理回传会把每个含推理轮次的思维链带入后续请求，丢弃超出上限的图片则避免再次支付这些 token；可用时会报告 cache-read 用量。

#### KV Cache 影响

未更改的已组装前缀，包括确定性编码的保留图片与占位文本，可使用 DeepSeek cache 复用，适配器会在 usage 中报告它。模型路由变更，或任何上游提示词、schema、前缀、历史或图片上限变更，都可能使从首个发生变化的 token 起的复用失效；推理回传会在每个含推理的轮次上追加。

### DeepSeek 响应

#### 模型看到的内容

推理、文本与原始字符串工具参数会转换为 harness 分片，供 loop 记录和组装。

#### Token 影响

生成 token 遵循请求中已记录的推理强度和 `maxTokens`；只有 loop 保留的块会影响后续输入。

#### KV Cache 影响

loop 保留的响应块会追加到下一个请求，并保留其较早可复用前缀；已丢弃块不会影响后续 cache。更改提供方或模型会选择不同 cache 域。

## 已知限制与暂缓事项

- **settings 的 `models` 列表会整体替换组合列表**：settings 层按字段合并，而数组是单个字段；按条目合并 catalog 需要带键的形状。
- **未映射 `tool_choice`**：它不属于核心词汇（MVP 取舍，与 pi-ai twin 共享）。
- **请求使用原始 `fetch`，而非 `@cordisjs/plugin-http`**：没有共享 proxy／拦截配置；采用暂缓到第二个适配器需要该功能时（`TODO(http)`）。
- **会跳过插件添加的内容块类型**：核心文本与支持的图片块会被序列化，空工具输出会以字面 `(no output)` 通过协议发送。
- **图片是仅输入的持久附件**：不支持直接外部 URL 和 assistant 图片输出；DeepSeek 图片输入通常使用 Files API，仅在单次请求恢复时使用内联 base64。
