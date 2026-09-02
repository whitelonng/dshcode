---
description: "Web GUI 宿主原生文件选择器的能力缝隙：抽象 FilePicker 服务定义、其唯一 native 交互形态，以及把以浏览器拖拽得到的文件名解析为宿主绝对路径的 locateByName 补充。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-file-picker

[English](README.md) | 中文

## 概述

Web GUI 宿主的本地文件选择器是一个能力缝隙（capability seam）。抽象服务 `FilePicker`（`ctx.filePicker`）是它的 Service Definition；`capability()` 返回唯一的 `native` 交互（`{ kind: 'native', pickFiles({ multiple }, signal) }`），它在宿主显示器上打开一个操作系统选择框，并把选中的绝对路径返回给调用方——操作者取消时返回 `null`。`locateByName`（`./locate` 子路径）是路径选择的补充：浏览器拖拽只能拿到文件的 `name`，因此宿主在目录树中按 basename 精确匹配并返回绝对路径。与目录选择器不同，这里没有 browse 孪生形态：远程客户端没有可供打开文件选择框的显示器，因此后端仅支持 native。

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

把本包组合进宿主组合；服务可注入为 `ctx.filePicker`，调用后会在宿主显示器上打开原生选择框。

### 何时选择它

当宿主需要为坐在终端前的操作者解析真实宿主路径时选择本包。若不存在宿主显示器——远程客户端没有可打开的选择框——则应隐藏选择入口而不是报错；浏览器拖拽场景只有 basename 可用，应使用 `locateByName`。

### 最小配置

无需挂载：本包提供 Service Definition 与其能力形态。native 后端（[`file-picker-native`](../file-picker-native/README.zh.md) 包）在组合中注册实现。

-----

<a id="理解实现"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

Service Definition 声明 `FilePicker` 及其提供方返回的能力对象。`capability()` 返回唯一的 `native` 交互形态，在宿主显示器上打开，并把选中的绝对路径返回给调用方（取消时返回 `null`）。能力对象在服务生命周期内必须保持稳定；未来新增后端时，通过向 `FilePickerCapabilities` 声明合并（declaration merging）来添加其形态，而不是修改本包。`locateByName` 在目录树中按 basename 精确匹配并返回绝对路径——不暂存任何字节、不写工作区；可选的 `systemSearch` 层级仅在目录树匹配未达到上限时才追加更广的结果。非原生选择无法把真实路径泄露给浏览器；`pickFiles` 是唯一能拿到真实路径的途径。

</details>

-----

<a id="延伸阅读"></a>
## 延伸阅读

- [目录选择器缝隙](../../../packages/host/directory-picker/README.zh.md)
- [原生文件选择器后端](../../../packages/host/file-picker-native/README.zh.md)
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)

-----

<a id="模型体验"></a>
## 模型体验

无。该 seam 服务于 GUI 宿主的本地文件选择；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

<a id="已知限制与暂缓事项"></a>

- **仅 native**——没有远程客户端交互形态；在不存在宿主显示器的部署中，应隐藏选择入口而不是报错。
- **系统级搜索由调用方提供**——`locateByName` 自行遍历工作区树，并通过可选的 `systemSearch` 委托接受任何更宽的搜索（spotlight/`find`），因此其覆盖范围和开销属于调用方的策略。

<a id="开发备注"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
