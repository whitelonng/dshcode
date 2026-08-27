# Agent Note：Web GUI 文件上传发送宿主路径，而非暂存字节

Status: implemented

[English](2026-08-27-web-file-upload-by-path.md) | 中文

## Problem

对话框只接受图片，而且只以 base64 内嵌进提示文本（`createDraftImages` 对非 `png/jpeg/webp/gif` 的 MIME 一律抛 `UnsupportedImageMediaTypeError`）。用户在既不暂存磁盘副本、也不膨胀对话上下文的前提下，无法把任意本地文件交给智能体。浏览器永远读不到拖拽文件的真实宿主路径——`File` 只暴露 `name`、`size` 和内容——因此「发送路径、让智能体去读」没有纯浏览器路线。

## Decision

两个互补的宿主能力，加上对话框的分流，全程只发路径：

- **`file-picker` / `file-picker-native`**（`ctx.filePicker`）：一个仅 native 的能力缝隙，其唯一交互 `pickFiles({ multiple }, signal)` 在宿主显示器上打开一个操作系统文件选择框并返回选中的绝对路径。只做 native，因为远程客户端没有可打开选择框的显示器；与 `directory-picker` 不同，没有 browse 孪生形态。网关以 `host.pickFiles` 提供它，在非 native 后端下回答 `file-picker-unavailable`（大声失败，绝不假装已选）。macOS 用 `osascript choose file`；Linux 用 Zenity、以 KDialog 回退；Windows 在建成 koffi `IFileOpenDialog` 文件多选对话之前大声失败。
- **Basename 定位**（`file-picker` 的 `./locate`）：`locateByName(root, name)` 遍历目录树做 basename 精确匹配并返回绝对路径——这是拖拽的零字节、零写入答案，其唯一输入就是 `name`。它接受可选的 `systemSearch` 委托来处理任何比工作区遍历更宽的搜索（spotlight/`find`），本增量不接线；网关的 `host.locateFiles` 只遍历会话工作区。
- **对话框分流**（`InputBar`）：对拖入/粘贴的文件按 MIME 分类——多模态图片照旧进图片轨道；其余全部经 `locateFiles` 解析并插入 `@path` 引用（复用 `formatFileMention`）——绝不暂存字节。新增的回形针按钮驱动 `pickFiles` 并把每个选中路径插为引用。basename 命中零个或多个时给出提示（「请用添加文件按钮」），而不是静默丢弃。

这些取舍胜出的原因：

- **只发路径胜过暂存。** 把副本暂存进工作区能满足「智能体按路径读」，但消耗磁盘并可能污染用户的目录树；内容寻址对象存储（如图片）能避开污染，却根本拿不出可读路径。返回真实路径是唯一同时做到零复制、零上下文、且智能体可读的方案。「模型可见 ⟺ 已入日志」天然成立：引用就是普通提示文本。
- **拖拽拿到的是名字，不是路径。** `locateByName` 的 basename 精确遍历在工作区这一层是精确且无歧义的；系统级层保持为注入式委托，因为其开销与覆盖范围属于调用方策略，而本增量尚无工作区之外的消费者。
- **仅 native，但仍然判别式。** `FilePickerCapabilities` 映射从第一天起就声明为可合并扩展，镜像 `directory-picker`，因此未来后端无需修改本包即可增加其形态。不支持的交互以大写的 `file-picker-unavailable` 码失败，与 `directory-picker-unavailable` 一致。
- **对话框里由 MIME 决定图片还是文件。** 图片轨道自身的准入同样以 MIME 为准，因此仅按后缀匹配会被拒；只按 MIME 路由保持单一规则，并让未知类型的文件落入路径定位（由智能体选择读取工具）。

## Alternatives considered

- **先暂存再引用、以及提交时原子暂存**——两者都写字节到磁盘（被拒；操作者要求零落地），且提交时暂存会把路径藏出草稿。
- **现在就内置系统级搜索**——按平台 `mdfind`/`find` 会引入操作系统命令面与开销策略，而本增量没有消费者；`systemSearch` 委托让缝隙保持就绪而不必现在拍板这些选择。
- **复用 `@file` 的 `WorkspaceFileSearch`**——那个索引为自动补全排序返回工作区相对路径，而不是从裸 basename 得到绝对路径；单独的 basename 精确遍历是另一个更小的查询。
- **给 `directory-picker` 加 `pickFiles` 方法**——被拒：该缝隙以目录选择命名，其 browse/native 契约关乎层级与创建，而非文件选择；兄弟包让每个契约的消费者集合保持诚实。

## Consequences

- 新增两个宿主包（`file-picker`、`file-picker-native`）、两个网关方法（`host.pickFiles`、`host.locateFiles`）和一个错误码（`file-picker-unavailable`），扩大了 Web GUI 的宿主面；各自镜像 `directory-picker` 缝隙，并受同一套 apiproxy/rpc/schema 层覆盖。
- 对话框按 `image/*` MIME 族分流，因此部署收窄 `imageLimits.mediaTypes` 不再改变「图片 vs 文件」的划分（`image/*` 类型保留图片轨道权威的「仅 PNG/JPG/WebP/GIF」拒绝）；空 MIME 文件始终按路径解析。
- Windows 文件选择未随此交付：在 koffi `IFileOpenDialog` 文件多选对话落地之前，`pickNativeFiles` 在 win32 上大声失败。远程客户端同样没有可打开选择框的显示器。
- `locateByName` 只遍历工作区树；更宽的 `systemSearch` 层级是注入式委托，留待出现工作区之外消费者时再接线。basename 命中零个或多个时给出「请用添加文件按钮」提示，而非猜测。