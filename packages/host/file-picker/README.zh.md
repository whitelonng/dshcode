# @deepseek-ai/dsh-host-file-picker

[English](README.md) | 中文

Web GUI 宿主的本地文件选择器是一个能力缝隙（capability seam）。抽象服务 `FilePicker`（`ctx.filePicker`）是它的 Service Definition；`capability()` 返回唯一的 `native` 交互（`{ kind: 'native', pickFiles({ multiple }, signal) }`），它在宿主显示器上打开一个操作系统文件选择框，并把选中的绝对路径返回给调用方——操作者取消时返回 `null`。与 [`directory-picker`](../directory-picker/README.zh.md) 不同，这里没有 browse 孪生形态：远程客户端没有可供打开文件选择框的显示器，因此后端仅支持 native。能力对象在服务生命周期内必须保持稳定；未来新增后端时，通过向 `FilePickerCapabilities` 声明合并（declaration merging）来添加其形态，而不是修改本包。

`locateByName`（`./locate` 子路径）是路径选择的补充：浏览器拖拽只能拿到文件的 `name`、永远拿不到其宿主路径，因此宿主在目录树中按 basename 精确匹配并返回绝对路径——不暂存任何字节、不写工作区。可选的 `systemSearch` 层级仅在目录树匹配未达到上限时才追加更广的结果。非原生选择无法把真实路径泄露给浏览器；`pickFiles` 是唯一能拿到真实路径的途径。

## Model Experience

无。该 seam 服务于 GUI 宿主的本地文件选择；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## Known Limitations and Deferred Work

- **仅 native**——没有远程客户端交互形态；在不存在宿主显示器的部署中，应隐藏选择入口而不是报错。
- **系统级搜索由调用方提供**——`locateByName` 自行遍历工作区树，并通过可选的 `systemSearch` 委托接受任何更宽的搜索（spotlight/`find`），因此其覆盖范围和开销属于调用方的策略。