---
description: "file-picker 缝隙的原生后端：以 native 能力注册 ctx.filePicker，每次选择通过 osascript 或 Zenity（回退 KDialog）在宿主显示器上打开一个操作系统文件选择框。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-file-picker-native

[English](README.md) | 中文

## 概述

[`file-picker`](../file-picker/README.zh.md) 缝隙的 native 后端：它以 `native` 能力注册 `ctx.filePicker`，并在每次选择时于宿主显示器上打开一个操作系统文件选择框。macOS 使用 `osascript`（`choose file`，多选时加 `multiple selections allowed`）；Linux 使用 Zenity（`--file-selection --multiple`），以 KDialog 作为回退。所有平台命令均为无 shell 调用，经可注入的 `NativeCommandRunner` 运行，并将换行分隔的绝对路径返回给调用方。Windows 目前刻意不支持并大声失败，而不是假装已选择。

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

把本包与 [`file-picker`](../file-picker/README.zh.md) 缝隙一起组合进宿主组合；它注册具体服务实现，使 `ctx.filePicker` 可解析。

### 何时选择它

当宿主有操作者坐在终端前、必须呈现原生操作系统文件选择框时选择本包。若是没有显示器的远程部署，或浏览器拖拽场景用 `locateByName` 已足够，则不必使用本包；在 `IFileOpenDialog` 驱动落地前，Windows 宿主仍不受支持。

### 最小配置

无需挂载：本包在组合中注册 native 实现。命令运行器可注入，因此测试替换为模拟运行器而非调用真实选择框。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本包以 seam 的 `capability()` 返回的 `native` 能力对象注册 `ctx.filePicker`。macOS 调用 `osascript`（`choose file`，多选时加 `multiple selections allowed`）；Linux 调用 Zenity（`--file-selection --multiple`），以 KDialog 作为回退。所有平台命令均为无 shell 调用，经可注入的 `NativeCommandRunner` 运行，因此没有 shell 插值触碰所选路径。每次选择把换行分隔的绝对路径返回给调用方；Windows 目前刻意不支持——koffi `IFileOpenDialog` 的文件多选对话是独立的一块工作——并大声失败（`native file picker is unsupported on win32`），而不是假装已选择。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [文件选择器缝隙](../../../packages/host/file-picker/README.zh.md)
- [目录选择器缝隙](../../../packages/host/directory-picker/README.zh.md)
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无。该 native 后端打开宿主的操作系统选择框；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **不支持 win32**——在实现 `IFileOpenDialog` 文件多选对话（沿用目录选择器已有的 koffi 驱动）之前，Windows 上的选择会大声失败。
- **仅适用于宿主本机屏幕**——远程部署没有可打开选择框的显示器，因此该后端仅在操作者坐于宿主机前时组合使用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
