# @deepseek-ai/dsh-tool-describe-image

[English](README.md) | 中文

**DeepSeek Harness 图片理解插件** —— `describe_image` 工具，经 OpenAI 兼容的 VLM 端点给纯文本模型识图能力（图片理解 · 多模态 · 视觉语言模型）。

面向模型的 `describe_image` 工具：为纯文本模型提供识图能力——把一张图（本地文件路径、http(s) URL 或持久附件引用）交给 OpenAI 兼容端点的视觉语言模型描述，返回的文本走普通工具结果路径，图片本身从不进入对话。本包拥有模型侧契约（工具名、JSON schema、参数名、规范值、结果渲染与 `generic`/`read` 调用卡片）以及 HTTP 客户端及其安全策略；没有可替换的 provider 缝——端点、模型与凭据都是本插件自己的配置。

## 安装

```sh
dsh plugin --profile web add github:whitelonng/dsh-plugin-describe-image
```

桌面应用的插件列表安装框可直接粘贴同一条 spec，插件在应用重启后加载。

## 工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `describe_image` | `image`（string）、`prompt?`（string） | 加载图片——本地绝对路径、拒绝重定向的 http(s) 下载，或 `[image attachment …]` 注记里的 JSON（经附件服务解析）——按魔数识别 PNG/JPEG/GIF/WebP，执行 `maxBytes` 上界，然后向配置的视觉模型提问——`prompt`，缺省时用 `defaultPrompt`。返回 `{ text, model, image, mimeType, bytes }`；模型只看到 `text`。 |

工具只在装载时注册一次；没有按调用选择模型或端点的参数，模型无法把图片路由到部署配置之外的任何后端。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | —（必填） | OpenAI 兼容端点根（如 `https://dashscope.aliyuncs.com/compatible-mode/v1`）；尾部斜杠会被去除。 |
| `model` | —（必填） | 该端点的视觉模型 id。 |
| `apiKey` | — | 内联 API key。本地快速上手的便利项；值会以明文躺在组合文件里。建议改用 `!!js process.env.VISION_API_KEY` 从环境注入，而不是粘贴字面量。 |
| `apiKeyEnv` | `VISION_API_KEY` | key 解析所用的凭据引用（环境变量名）；设为空字符串则关闭引用解析。 |
| `defaultPrompt` | 见源码 | 调用未带 `prompt` 时发送的指令。 |
| `maxBytes` | `10485760` | 图片字节上界，本地文件与下载一视同仁。 |
| `maxOutputTokens` | `1024` | 作为 `max_tokens` 发送的输出 token 上界。 |
| `timeoutMs` | `60000` | 单次视觉请求超时。 |

API key 每次调用解析一次，先匹配者胜：显式 `apiKey` → [凭据缝](../../credentials/README.md)解析 `apiKeyEnv`（它管环境变量、`.env` 与托管存储各层）→ 仅当未组合凭据缝时才看启动环境。完全没有 key 的调用以 `no API key` 错误失败，而不是装载失败——之后存入的 key 无需重启即对下一次调用生效。端点与边界配置错误在装载时即大声失败。

所有字段也可以在 Web GUI 的「设置 → 插件 → 图像理解」卡片中实时修改：卡片写入 `describe-image` 设置段，提交后下一次调用即生效。卡片的 API Key 控件走凭据缝——明文密钥绝不随设置响应传输。

```yaml
- id: describe-image
  name: '@deepseek-ai/dsh-tool-describe-image'
  config:
    baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
    model: qwen-vl-max
    apiKey: !!js process.env.VISION_API_KEY
```

## 安全

- 视觉请求与图片下载都拒绝 HTTP 重定向（`redirect: 'error'`），凭据与图片字节永远不会被转发到部署未配置的源站。
- 请求体携带 base64 图片但从不携带 key；任何日志都不记录请求头或解析出的凭据。错误摘要限制在 200 字符。
- 只接受 `http(s)` URL 与本地路径，其他 URL scheme 一律拒绝。
- 响应体在解析前设有上界（`maxOutputTokens * 8 + 64 KiB`）。

## 常见问题

**它是干什么的？** 注册面向模型的 `describe_image` 工具：一张图进去，配置的视觉模型的描述文本出来。

**支持哪些视觉模型？** 任何 OpenAI 兼容端点——Qwen-VL、GLM-4V、GPT-4o，或本地 Ollama 端点。

**图片会进入对话或会话日志吗？** 不会——只有返回的描述文本跨入对话。

**API Key 怎么配置？** 内联 `apiKey` → 凭据缝（`apiKeyEnv`，默认 `VISION_API_KEY`）→ 启动环境；密钥从不写入日志。

## Model Experience

### Tool schema

#### What the model sees

生成的 [`describe_image` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-describe-image)。描述中写明支持的媒体类型与 `maxBytes` 上界；部署端点、凭据名与超时不是模型可见面。

#### Token effect

工具注册期间每次请求的固定 schema 开销。

#### KV Cache effect

schema 与描述不变时前缀稳定；插件生命周期或改变描述的配置变化可能从第一个变化的 schema token 起失效复用。

### Result

#### What the model sees

恰好是视觉模型的 `text` 答案，渲染为纯文本块。失败结果携带 `describe-image:` 前缀的消息（边界拒绝、媒体类型、带截断摘要的 HTTP 状态、中止、超时或缺失凭据）。

#### Token effect

数据相关的结果会一直重发直到压缩；工具本身不添加持久提示词段落。

#### KV Cache effect

仅追加；新可见内容接在可复用的请求前缀之后，不会使已有 KV-cache 条目失效。

## Known Limitations and Deferred Work

- **仅头部校验** — 魔数门检测媒体类型但不解码图片；头部合法而载荷损坏的文件会在视觉端点处失败，而不是在本工具处。
- **一图一答** — 不支持多图输入、对上一张图的追问，也不输出结构化结果（坐标、包围盒）。需要反复看-判断-再看或像素级 UI 控制的工作应使用视觉模型子代理，而不是本工具。
- **文字提取仍消耗一次 VLM 调用** — 没有本地 OCR 兜底；只做文字提取的部署可把 `baseURL` 指向更便宜的 OCR 优先模型（或本地 Ollama 端点）。
- **仅限 OpenAI 兼容契约** — chat-completions 请求或响应形状不同的提供方需要单独的工具或适配器；线上格式固定在源码中。
