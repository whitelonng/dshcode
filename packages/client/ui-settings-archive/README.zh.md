---
description: "Web 设置中的归档会话页面：列出每个注册表级归档会话，支持按标题或会话 id 搜索、批量恢复或彻底删除，并通过 workspace 归档层回调驱动语义。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-archive

[English](README.md) | 中文

## 概述

Web 设置中的归档会话页面。一个 section（`settings.section`，id `archive`）列出每个注册表级归档会话及其折叠标题与创建时间；搜索框按标题或会话 id 过滤行，选择复选框与批量工具栏跨选中行驱动恢复（非破坏性）与彻底删除（不可逆）。单行操作镜像同样的两项操作。线面（`list` / `restore` / `remove`）由 `apply` 注入，走共享的 `/api` fetch 载体，响应在客户端边界校验，RPC 失败以携带宿主错误码的 `ArchiveActionError` 拒绝，供区块把已知错误码映射为可操作的文案。

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

把本包组合进客户端装配并让它注册 `settings.section` 条目；归档页面出现在 Web 设置下。

### 何时选择它

当设置界面需要让人类控制哪些会话保持归档——列出、搜索、恢复或彻底删除它们时选择本包。若某个会话内管理界面已自己拥有归档行，直接注入归档回调更简单，则不必使用本包。

### 最小配置

无需挂载：本包不向任何组合注册内容。其线面由 `apply` 注入并读取共享的 `/api` fetch 载体，因此不需要任何配置行。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本区块从 workspace 归档集合快照渲染行。恢复通过客户端 `workspaces` 服务（网关上的 `workspace/restoreSession`）把会话移出归档集合，会话在其原 workspace 位置重新出现；彻底删除调用同一服务的删除（`workspace/deleteSession`），宿主从持久化中移除会话日志并清除其 workspace 记账与归档集合条目——转发的 `api-session/deleted` 帧让每个已连接的客户端把该会话从列表镜像中驱逐。仍活跃的会话以 `workspace/session-active` 拒绝彻底删除，区块把该错误码映射为说明处理方式的文案。线面（`list` / `restore` / `remove`）由 `apply` 注入，携带 workspace 归档层回调，在 `protocol.ts` 中于客户端边界校验每条响应，并以携带宿主错误码的 `ArchiveActionError` 拒绝，供区块把已知错误码映射为可操作的文案。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)
- [客户端 workspace API](../../../packages/api/workspace-controller/README.zh.md)
- [Settings seam](../../../packages/settings/settings/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 浏览器设置区块

#### 模型看到的内容

归档区块不产生任何模型可见内容。本页不发起任何模型请求，不持有对话上下文，也不注册任何面向模型的内容；列表由宿主的 `session-query` 服务经 `workspace/listArchived` 从持久化会话日志折叠而来。

#### Token 影响

当前进程内为零。

#### KV Cache 影响

当前进程内无影响；本区块不会给任何提供方请求带来变化。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 附件字节是 content-addressed 且跨会话共享；彻底删除移除会话日志，但孤儿附件文件会保留到未来的垃圾回收通道。
- 列表在挂载与每次变更后刷新；在另一个窗口执行的删除会在下次打开本页时生效。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
