---
description: "settings 编辑器的浏览器侧 schema 与草稿编辑层：还原 settings.describe 的 schemastery 封装、按 settings 路径解析 schema 节点，并以路径级覆盖语义不可变地编辑草稿。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-schema-form

[English](README.md) | 中文

## 概述

面向 settings 编辑器的 schema／草稿模型层。`rehydrateSchema` 把 wire 侧 `settings.describe` 的封装还原为活的 schemastery 校验器，因此在宿主上校验分节的那份 schema 对象，就是在浏览器里校验草稿的那份对象，客户端校验零漂移。`nodeAtPath` 解析可配置提供方目录 `settingsPath` 所寻址的 schema 节点，`setPath`／`deletePath`／`hasPath` 以存在性覆盖语义不可变地编辑草稿。`validateDraft` 运行还原出的校验器并返回失败消息，页面得以在写入前拒绝无效草稿。该包不含任何 React，也不做任何渲染：编辑器在这些辅助函数之上自建控件。

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

从包根导入这些辅助函数，并在编辑器组件的控制器里驱动它们。

### 何时选择它

当某个 settings 界面要编辑它并不完全拥有的 namespace 时选择本包：可配置提供方的 Models 页在决定渲染什么之前，通过 `nodeAtPath` 探测提供方 profile。若编辑器完全了解目标 namespace，直接围绕 settings scope 手写带类型的表单更简单，此时不必使用本包。

### 最小配置

无需挂载：本包不向任何组合注册内容。它的 invariant 伴生（`./invariant` 入口上的 `apply`）是空安装器——纯辅助库不拥有任何跨插件可变关系。

-----

<a id="理解实现"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

[`src/model.ts`](src/model.ts) 承载全部 API：`rehydrateSchema` 用 `new Schema(json)` 复原 `schema.toJSON()` 的 ref 封装；草稿辅助函数在 `setPath` 时物化中间对象、在 `deletePath` 时删除键，并把字段是否存在视为覆盖状态。settings seam 的分层方式赋予存在性语义以意义：不存在的键回退到组合 base 与 schema 默认值。

</details>

-----

<a id="延伸阅读"></a>
## 延伸阅读

- [Web 客户端架构](../../../docs/subsystems/web-client.md)
- [Settings seam](../../../packages/settings/settings/README.md)
- [Web 配置平面 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-30-web-config-plane.md)
- [新增包指南](../../../docs/cookbook/adding-a-package.md)

-----

<a id="模型体验"></a>
## 模型体验

无。该包支撑的是浏览器配置编辑器；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

<a id="已知限制与暂缓事项"></a>

- **还原会执行所服务的封装** — `rehydrateSchema` 重建活的 schemastery 校验器，而 schemastery 通过 `new Function` 复原序列化回调，因此 schema 封装是可执行内容而非惰性数据。只有来自服务页面的同一可信宿主的封装才是安全的；协议不提供跨信任的惰性表示。
- **校验是草稿级而非逐字段** — `validateDraft` 报告 schemastery 的第一条失败消息（含 `$.path`），不会把错误映射到单个控件。
- **没有通用渲染器** — 消费者在这些辅助函数之上构建特性专属表单。[Web 配置平面 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-30-web-config-plane.md) 记录了这一取舍。

<a id="开发备注"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
