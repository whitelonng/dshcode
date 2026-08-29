# @deepseek-ai/dsh-attachment

[English](README.md) | 中文

持久附件服务边界。`ctx.attachments` 校验并持久提交提供方无关的规范化图片，随后返回可序列化的 `ImageAttachmentRef`；消费方绝不会在会话事件中持久保存浏览器路径、对象 URL、提供方 URL 或 base64。

未发送的输入区图片仍是由浏览器持有的临时草稿。`validateImage` 运行完整准入策略但不执行持久化。`saveImages` 负责批次图片数量和总字节限制，在发布任何成员前准备全部规范化附件，然后按顺序提交，并且只在完整批次成功后返回引用。后续存储失败不会返回部分引用，但较早写入的不可变内容寻址对象可能保持不可达，直至具备按引用感知的垃圾回收。`AttachmentError.code` 使用封闭的 `AttachmentErrorCode` 字符串联合类型。其 `ImageAdmissionErrorCode` 子集标记可由调用方修正的图片输入失败；`isImageAdmissionError` 在运行时识别该子集，使每个协议适配器可以映射自己的错误词汇。`saveImage` 会在发布任何模型可见的会话事件前提交一张已接受的图片，并直接返回 `ImageAttachmentRef`。规范化过程缩小图片时，引用会通过 `originalDimensions` 记录应用方向后的输入尺寸。`readImage` 根据已记录的元数据校验规范化附件。`readImageRequest` 确定性派生路由所需的请求版本，其身份覆盖附件 ID、变换策略版本、像素和字节预算及编码参数。调用方通过 `Promise.all(refs.map(...))` 组合有序批次，本地实现仍通过实例级限流器、缓存和 singleflight 限制压缩并发。调用方可以取消读取和投影；实现保留取消结果，不把它转换为存储失败。

`admitEncodedImages(attachments, images)` 是每个接受浏览器上传的 RPC 端点（会话 prompt 端点与命令执行器）共用的 wire 入口：它对每个成员强制执行规范 base64，随后把批量准入——限额、校验、有序提交——委托给 `saveImages`。base64 上传形式为 `EncodedImageAttachment`，从 `@deepseek-ai/dsh-attachment/types` 导出，供 wire 契约引用。

## 模型体验

该包通过角色无关的核心 `ImageBlock`，以及把持久引用解析为确定请求版本的提供方适配器，间接影响模型。请求描述会公开完整附件 ID 和实际请求尺寸。

#### KV 缓存影响

添加图片会改变提供方请求，因此会使受影响的请求后缀失效。

## 已知限制与待完成工作

- 第一版仅接受 PNG、JPEG、WebP 和 GIF。
- 保留策略与垃圾回收尚未实现，因为恢复和 fork 后的会话可能共享不可变对象。
- 通用文件、音频、视频和持久的未发送草稿需要单独的生命周期与提供方契约。
