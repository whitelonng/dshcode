# @deepseek-ai/dsh-host-plugin-control

[English](README.md) | 中文

为部署方拥有的一组逻辑插件开关提供仅限回环访问的持久化能力。组装 profile 提供绝对路径 `profilePatchPath` 和 `controls` 清单；每个清单项都包含稳定的控制 id、显示名称、HTTP(S) 仓库 URL，以及一个或多个 profile 本地 Loader 条目 id。`PluginControlGateway` 要求每个本地 id 恰好解析为一个已挂载条目，投影 `enabled`、`disabled`、`mixed` 或 `unavailable` 状态，并通过通用 Connection 通道 `/plugin-control` 暴露 `list` 与 `set-enabled`。

`set-enabled` 会校验请求的控制项、串行执行并发写入，并且只改写当前 profile 的 `cordis.patch.yml` 中带有 `# dsh-plugin-control: <id>` 标记的 YAML 行。写入器使用共用的文件锁与原子发布辅助函数，在已有 profile 目录内以私有权限创建缺失的文件，并保留无关行、注释及 `!!js` 表达式。社区插件不必支持可逆的运行时注册，因此不会修改正在运行的 Loader 树；返回快照表示已保存的设置，下一个 DSH 进程会通过普通 profile patch 顺序应用它。

该路由只接受具有回环权限的请求。远程浏览器不能通过此通道读取或修改控制项，调用方也不能访问部署清单之外的任意 Loader 条目。YAML 无效、条目缺失或存在歧义、仓库 URL 不安全、所有权重复及未知控制 id 都会明确失败，并保留现有 patch 文件。

## 模型体验

### 重启期插件选择

#### 模型看到的内容

`plugin-control` 自身没有任何内容。它不注册提示词、工具、消息或模型提供方；DSH 重启后，由所选插件决定其各自的模型可见贡献是否存在。

#### Token 影响

当前进程中为零。重启后的 token 变化属于启用或关闭的插件。

#### KV Cache 影响

对当前进程没有影响。重启后，启用或停用插件可能依照该插件自身行为改变请求前缀或工具列表。

## 已知限制与暂缓事项

- **需要重启** —— 开关会持久化期望状态，但不会卸载或重新加载当前插件 fiber，因为第三方插件 teardown 后可能仍保留路由、工具或其他注册。
- **只控制配置的产品** —— 端点只控制部署方提供的逻辑清单，并不是 Loader 清单的通用修改 API。
- **后续层仍有更高优先级** —— 应用在 profile patch 之后的 home 级 patch 或命令行 overlay，可能在下次启动时覆盖已保存设置。
- **不订阅文件系统变化** —— 启动后直接编辑文件，不会反映在当前 gateway 快照中，直至进程重启。
