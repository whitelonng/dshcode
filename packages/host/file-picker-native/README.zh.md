# @deepseek-ai/dsh-host-file-picker-native

[English](README.md) | 中文

[`file-picker`](../file-picker/README.zh.md) 缝隙的 native 后端：它以 `native` 能力注册 `ctx.filePicker`，并在每次选择时于宿主显示器上打开一个操作系统文件选择框。macOS 使用 `osascript`（`choose file`，多选时加 `multiple selections allowed`）；Linux 使用 Zenity（`--file-selection --multiple`），以 KDialog 作为回退。所有平台命令均为无 shell 调用，经可注入的 `NativeCommandRunner` 运行，并将换行分隔的绝对路径返回给调用方。

Windows 目前刻意不支持——koffi `IFileOpenDialog` 的文件多选对话是独立的一块工作——它大声失败（`native file picker is unsupported on win32`），而不是假装已选择。

## Model Experience

无。该 native 后端打开宿主的操作系统选择框；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## Known Limitations and Deferred Work

- **不支持 win32**——在实现 `IFileOpenDialog` 文件多选对话（沿用目录选择器已有的 koffi 驱动）之前，Windows 上的选择会大声失败。
- **仅适用于宿主本机屏幕**——远程部署没有可打开选择框的显示器，因此该后端仅在操作者坐于宿主机前时组合使用。