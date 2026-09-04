---
description: "为部署方拥有的一组逻辑插件开关提供仅限回环访问的持久化能力：投影 enabled/disabled/mixed/unavailable 状态，只改写 profile patch 中带标记的 YAML 项，并以 uninstalled 标记卸载产品。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-control

[English](README.md) | 中文

## 概述

为部署方拥有的一组逻辑插件开关提供仅限回环访问的持久化能力。组装 profile 提供绝对路径 `profilePatchPath` 和 `controls` 清单；每个清单项都包含稳定的控制 id、显示名称、HTTP(S) 仓库 URL，以及一个或多个 profile 本地 Loader 条目 id，每个 id 都与同序的模块标识配对。`PluginControlGateway` 投影 `enabled`、`disabled`、`mixed` 或 `unavailable` 状态，并通过通用 Connection 通道 `/plugin-control` 暴露 `list`、`set-enabled` 与 `uninstall`。`set-enabled` 会校验请求、串行执行并发写入，并且只改写当前 profile 的 `cordis.patch.yml` 中带有 `# dsh-plugin-control: <id>` 标记的 YAML 项。该路由只接受具有回环权限的请求；远程浏览器不能读取或修改控制项，调用方也不能访问部署清单之外的任意 Loader 条目。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本包与 `profilePatchPath` 和 `controls` 清单一起组合进宿主组合；网关挂载在 Connection 通道 `/plugin-control` 上，只应答具有回环权限的请求。

### 何时选择它

当部署必须让操作者在跨重启范围内切换一组已知插件产品、但不暴露通用插件修改 API 时选择本包。若没有部署固定的清单，或插件在带外启停，则不必使用本包；任意用户安装插件由 [`plugin-installer`](../../../packages/host/plugin-installer/README.zh.md) 网关负责。

### 最小配置

组装 profile 提供 `profilePatchPath`（指向 profile 的 `cordis.patch.yml`）和 `controls` 清单；每个清单项携带稳定的 id、显示名称、仓库 URL，以及它的 Loader 条目 id 与模块标识。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`set-enabled` 校验请求的控制项、串行执行并发写入，并且只改写当前 profile 的 `cordis.patch.yml` 中带有 `# dsh-plugin-control: <id>` 标记的 YAML 项。行放在 `insert` 项里，每行带条目 id 与模块名（用户 patch 层把裸行当作对既有条目的补丁，因此启用从未挂载过的产品必须 insert 而非 override）。启用会写入 insert 行；行不存在时禁用已是有效状态，不写任何内容。写入器使用共用的文件锁与原子发布辅助函数，在已有 profile 目录内以私有权限创建缺失的文件，并保留无关行、注释及 `!!js` 表达式。社区插件不必支持可逆的运行时注册，因此不会修改正在运行的 Loader 树；返回快照表示已保存的设置，下一个 DSH 进程会通过普通 profile patch 顺序应用它。`uninstall { pluginId }` 把产品的受管行替换为 `uninstalled: true` 标记项，使其跨重启从 `list` 隐藏，且下次启动不再挂载其行；重新启用该产品会重写受管项并清除标记。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [宿主 plugin-installer 网关](../../../packages/host/plugin-installer/README.zh.md)
- [Settings seam](../../../packages/settings/settings/README.zh.md)
- [profile patch 组合](../../../docs/cordis-primer.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 重启期插件选择

#### 模型看到的内容

`plugin-control` 自身没有任何内容。它不注册提示词、工具、消息或模型提供方；DSH 重启后，由所选插件决定其各自的模型可见贡献是否存在。

#### Token 影响

当前进程中为零。重启后的 token 变化属于启用或关闭的插件。

#### KV Cache 影响

对当前进程没有影响。重启后，启用或停用插件可能依照该插件自身行为改变请求前缀或工具列表。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **需要重启** —— 开关会持久化期望状态，但不会卸载或重新加载当前插件 fiber，因为第三方插件 teardown 后可能仍保留路由、工具或其他注册。
- **只控制配置的产品** —— 端点只控制部署方提供的逻辑清单，并不是 Loader 清单的通用修改 API。
- **后续层仍有更高优先级** —— 应用在 profile patch 之后的 home 级 patch 或命令行 overlay，可能在下次启动时覆盖已保存设置。
- **不订阅文件系统变化** —— 启动后直接编辑文件，不会反映在当前 gateway 快照中，直至进程重启。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
