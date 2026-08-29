# `@deepseek-ai/dsh-file-reference-local`

[English](README.md) | 中文

`ctx.fileReferences` 的本地文件系统实现。它为每个 agent（智能体）维护一个有界的 `WorkspaceFileSearch`，以该会话的 `cwd` 为根目录；缺少该值时回退到宿主进程的 cwd。查询包含 `/` 时，索引会对直接列出的目录项排序；否则会对有界递归索引进行模糊排序。索引永远不会跟随目录符号链接。

工具结果事件会使指定 agent 的可复用索引失效，使后续补全能够反映工作区中可能发生的变更。agent 的 dispose（资源释放）会释放该索引及其作用域内的提示词贡献；插件 dispose 会等待所有提示词 fiber，并释放全部缓存的搜索器。

## 配置

| 配置键 | 默认值 | 契约 |
|---|---:|---|
| `maxResults` | `20` | 单次查询返回的候选项最大数量。 |
| `maxEntries` | `10000` | 每个 agent 工作区建立索引的文件和目录最大数量。 |
| `excludedDirectories` | `[".git", "node_modules"]` | 遍历和候选项中排除的目录基名。 |

所有数值都必须是正的安全整数。排除名称必须是非空基名，且不能包含 `/` 或 `\`。

## 模型体验

### `read` 可用时的文件引用指引

#### 模型看到什么

当指定 agent 有实际生效的 `read` 工具时，提供方会贡献以下稳定的系统提示词段：

##### 文件引用指令

```markdown
Paths prefixed with @ are files explicitly referenced by the user. Use the read tool when their contents are needed; do not claim to have inspected a file before reading it.
```

#### Token 影响

该影响有条件且固定：只要 `read` 对指定 agent 可见，这一句就会存在；候选查询本身不增加 token，所选路径只会贡献普通用户消息中的对应字符。

#### KV 缓存影响

该稳定句子会加入系统提示词前缀。挂载或移除此提供方，或者改变 `read` 是否可见，都会改变该前缀；查询、候选项和索引失效不会改变前缀。

## 已知限制与暂缓事项

- **宿主本地命名空间**：提供方扫描 Harness 宿主的文件系统，因此远程或虚拟 `read` 实现需要使用命名空间与该工具一致的提供方。
- **有界的提示性索引**：超大型工作区可能省略 `maxEntries` 之后的路径；被排除或无法读取的目录不会出现。
- **没有忽略文件语义**：`.gitignore` 和其他项目忽略文件不会影响发现；系统只排除已配置的目录基名。
