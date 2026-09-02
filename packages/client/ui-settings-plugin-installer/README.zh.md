---
description: "Web 插件设置中的合并插件列表标签页：为 profile 的用户安装插件提供安装、更新、卸载、检查更新，并展示启动失败与安全模式及其恢复动作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-installer

[English](README.md) | 中文

## 概述

Web 插件设置中的合并插件列表标签页（`settings.plugins.tab`，id `plugins`）。本标签页从 npm spec 或 git 仓库 URL 把插件安装到 profile 的共享模块 fallback，比较已装版本与 registry 或远端 HEAD，更新与卸载行，并展示启动失败与安全模式状态及其恢复动作。安装、更新与开关切换结束后有重启入口：桌面壳原地重启应用，浏览器中提示重启 `dsh web`。本标签页自身不发起模型请求；只有修复动作会创建普通用户对话，其首条消息内嵌失败记录。

## 目录

- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [延伸阅读](#延伸阅读)
- [模型体验](#模型体验)
- [已知限制与暂缓事项](#已知限制与暂缓事项)
- [开发备注](#开发备注)

-----

<a id="使用本包"></a>
## 使用本包

把本包组合进客户端装配；`plugins` 标签页出现在 Web 插件设置下，经共享的 `/api` 载体与宿主 plugin-installer 网关通信。

### 何时选择它

当 GUI 需要让人类控制 profile 的用户安装插件——安装、更新、卸载或修复一个失败的插件时选择本包。若宿主不暴露 plugin-installer 网关，或部署在带外管理其插件集、无需这些动作，则不必使用本包。

### 最小配置

无需挂载：本包经常规客户端装配注册其设置标签页，并从 `apply` 注入其线面。宿主侧必须组合 [`plugin-installer`](../../../packages/host/plugin-installer/README.zh.md) 网关，本标签页的动作才能解析。

-----

<a id="理解实现"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本标签页经共享 `/api` fetch 载体驱动宿主网关。**安装**接受 npm spec（`name`、`name@version`、`name@range`）或 git 仓库 URL；宿主把来源记录到 `$DSH_HOME/plugins.json`，并向 profile 用户 patch 层插入 loader 行。**检查更新**把已装版本与 npm `dist-tags.latest`（git 来源则为远端 HEAD）比较，逐行显示徽标。**更新**从记录的来源重新安装并刷新列表。**卸载**需要确认，然后删除安装目录、patch 行与状态条目。**启动失败**对启动失败记录显示徽标与失败摘要，并带两个动作——让 Agent 修复（打开一个工作区为插件安装根目录、内嵌失败的对话）或复制错误。**安全模式**在桌面端跳过用户 patch 层时说明开关不可用，并提供恢复正常模式并重启。线面由 `apply` 注入，并在客户端边界校验响应。

</details>

-----

<a id="延伸阅读"></a>
## 延伸阅读

- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)
- [Settings seam](../../../packages/settings/settings/README.zh.md)
- [宿主 plugin-installer 网关](../../../packages/host/plugin-installer/README.zh.md)

-----

<a id="模型体验"></a>
## 模型体验

### 浏览器插件标签页

#### 模型看到的内容

`plugins` 标签页本身不产生任何模型可见内容。本标签页不发起模型请求，也不注册任何面向模型的内容；宿主从配置的 npm registry 或 git 远端下载包。修复动作创建的是普通用户对话，其首条消息内嵌失败记录——该消息与其他用户消息一样对模型可见。

#### Token 影响

当前进程内为零；修复对话只在用户发送后消耗 token。

#### KV Cache 影响

当前进程内无影响；本标签页不会给任何提供方请求带来变化。

## 已知限制与暂缓事项

<a id="已知限制与暂缓事项"></a>

- git 来源需要本机存在 `git` 二进制；npm 来源经 HTTPS 下载，尚无完整性固定（integrity pinning）。
- 更新检测仅做来源比较（`dist-tags.latest` / 远端 HEAD）；npm 范围解析从不选择预发布版本。
- 安装任意包意味着重启后以完整宿主权限运行其代码——UI 通过重启流程隐含提示；安装前请审查来源。
- 修复对话就地修改已安装副本；之后的重新安装或更新会覆盖修复内容。

<a id="开发备注"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
