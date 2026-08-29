# `@deepseek-ai/dsh-client-ui-reference`

[English](README.md) | 中文

统一的 Web `@file` 与 `@session` source。对于未加引号的 token，浏览器会同时启动 `fileReferences/list` 和 `sessionReferenceResolver/candidates` Remote 调用，以确定性顺序把文件排在会话之前，并使用注册在 locale 字典中的文件夹、文件与会话标签；各行分别渲染在不可选择的文件与会话分组标题下，不显示重复的原始 `reference` source 标题。任一候选领域的失败都会独立降级。尚未闭合的 `@"…` token 只搜索文件。

选择文件会把共享 `@path` 语法所定义的自然文本保留为隐藏的序列化与剪贴板形式。文件会关闭补全，并显示为文件图标加业务色文件名、无胶囊容器的原子行内引用。目录仍是带文件夹图标的可编辑路径纯文本，并让菜单在尾部斜杠处保持活跃，用户可以继续进入下一层。包含空白的路径使用 `@"path with spaces"`，用户显式打开的引号会继续保留。

选择会话会插入一个原子的行内引用，其隐藏 `ref` 与剪贴板表示均为宿主返回的规范 `@[label](dsh-session:…)` mention。可见形式为聊天气泡图标加业务色会话标题，不使用胶囊容器；序列化永远不会根据该标题重建身份。普通发送会通过 `session.prompt` 携带规范 mention，session-reference 服务会在 `agent/pre-step` 校验它并捕获模型上下文。

`/client` 只导出插件主体（`apply`／`inject`）；候选编码保留在注册 effect 内部。

## 模型体验

间接影响模型体验：路径指引由 `@deepseek-ai/dsh-file-reference-local` 提供，准备后的会话快照由 `@deepseek-ai/dsh-session-reference` 提供。

#### KV 缓存影响

浏览候选项不会影响模型。选择文件或会话只会改变新用户消息的后缀，以及紧随该消息、由宿主准备的会话引用上下文；目标会话更早的历史保持不变。

## 已知限制与暂缓事项

- **候选失败有意保持静默**：Remote 发现调用不可用或失败时，该领域不产生候选行。会话引用准备失败发生在提示词接受后，并会终止该 agent 轮次。
- **浏览器侧不扫描文件**：Web 补全需要挂载宿主 `ctx.fileReferences` 提供方；浏览器无法回退到自身文件系统。
- **会话搜索仍仅使用元数据**：发现流程通过 `ctx.sessionReferenceResolver` 筛选 session id、cwd 和以日志为依据的最新标题；不搜索消息主体或完整 transcript（文本记录）。
