# `@deepseek-ai/dsh-file-reference`

[English](README.md) | 中文

文件引用发现 seam，以及供宿主驱动的用户界面共享、可在浏览器中安全使用的 `@file` 语法。`ctx.fileReferences.list(agent, query, signal)` 为指定 agent（智能体）返回仅含路径的文件或目录候选；具体提供方负责命名空间访问、排序、缓存和失效处理。同一契约以一元 `fileReferences/list` Remote 方法对外可调（`@Remote` 标注在 Service Definition 上，经保留的末位 signal 参数取消），浏览器消费方直接调用 `ctx.remote.fileReferences.list`，无需 API Proxy 路由。

`activeAtToken()` 只在输入开头或空白后识别 `@path` 或尚未闭合的 `@"path with spaces` token，因此类似电子邮件的文本不会打开补全。`formatFileMention()` 会生成与提示词匹配的写法，为目录候选追加 `/`，保留显式打开的引号，并拒绝编辑器语法无法安全表示的控制字符或内嵌引号。

选择候选项不会读取或附加文件内容。导出的 `FILE_REFERENCE_PROMPT` 是稳定指引；当指定 agent 可以调用 `read` 时，提供方可以安装该指引。

## 模型体验

间接影响模型体验：`@deepseek-ai/dsh-file-reference-local` 会按条件贡献本包的稳定文件引用指引。

#### KV 缓存影响

接口和语法本身不会增加请求 token；缓存行为取决于提供方拥有的提示词段。

## 已知限制与暂缓事项

- **路径候选仅供参考**：该 seam 不保证后续面向模型的文件系统工具能够访问同一命名空间；部署时必须让提供方与实际生效的 `read` 实现对齐。
- **没有文件内容引用对象**：所选文件仍是普通提示词文本，其内容必须经过模型显式调用工具后才对模型可见。
