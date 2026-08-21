# Agent Note: note 图片策略让纯文本路由可以承载含图会话

Status: implemented

[English](2026-08-16-note-image-policy-text-only-model-selection.md) | 中文

## 问题

describe-image 图片管线（[工具 README](../../../../packages/vision/tool-describe-image/README.zh.md)）通过在 DeepSeek 线路把图片内容块展平为可复制的 `[image attachment …]` 备注，让 DeepSeek 的纯文本模型获得视觉能力；主机也因此在纯文本路由上接收含图提示，使这些备注能到达模型。但配套的 `session.selectModel` 门槛仍假定每条纯文本路由都会拒绝图片内容：只要会话历史（或待处理收件箱）里带着图片，选择任意 DeepSeek 模型或思考等级都会返回 `model-unavailable`（"does not accept image input, but this session already contains images"）。用户可以围绕附加的图片对话，但对话中途切换模型或思考等级就会让会话搁浅。

门槛自身的注释记录了错误的假定："both wire routes reject image content on text-only models"。实际上只有 pi-ai 路由会拒绝；DeepSeek 路由按设计把图片序列化为备注（[multimodal 笔记](../feature/2026-07-22-web-multimodal-image-input-and-durable-attachments.zh.md)记录的是本 fork 后来偏离的那条拒绝行为）。

## 决策

`LlmModelInfo` 新增 `imagePolicy: 'note' | 'reject'` —— 当端点无法原生接收图片输入时，适配器如何承载图片内容块。缺省为保守负向（`reject`）。DeepSeek 适配器为每个模型声明 `note`，目录内模型与未收录模型一视同仁。`LlmRuntime` 校验该字段（`INVALID_CATALOG` / `INVALID_MODEL_INFO`）并在两个元数据查询中透传。`session.selectModel` 仅当目标模型的 `inputModalities` 显式排除 `image` **且**策略不是 `note` 时拒绝含图会话；模态未知时保留既有的"放行、由适配器守卫兜底"行为。

该策略是路由元数据，不是模态声明：DeepSeek 仍声明 `inputModalities: ['text']`，因此按原生图片输入把关的工具消费者（`read_image`）不受影响。

## 备选方案

**删除选择门槛。** 否决：拒绝型路由（pi-ai 纯文本模型）会在请求时搁浅会话且无法在产品内恢复；门槛存在的意义就是在边界处拒绝这种选择。

**给 DeepSeek 模型声明 `inputModalities: ['text', 'image']`。** 否决：端点从不接收图片数据；目录会向模型选择器和 `read_image` 等消费者宣传视觉能力，而序列化器只会把它们递进来的东西展平成备注。

**在插件内部把图片块改写成描述文本。** 否决：改写发生在 `agent/pre-step`，此时会话已记录图片，且排队消息可能仍停在待处理收件箱 —— 这个竞态窗口内选择门槛仍会触发，而且用户在记录中附加的图片会从聊天记录里消失。

## 后果

会话含持久或待处理图片内容时，切换 DeepSeek 模型或思考等级现在可以成功，与 describe-image 管线已经依赖的接收路径保持一致。拒绝图片内容的纯文本路由仍在选择边界被拒绝。新字段进入生成的 cordis API 目录；不声明该字段的 fixture 和适配器保持原有保守行为。

## Related

- [Web multimodal image input and durable attachments](../feature/2026-07-22-web-multimodal-image-input-and-durable-attachments.zh.md) 拥有图片内容块、模态元数据，以及本管线所偏离的原始纯文本拒绝行为。
- [Atomic Web image admission](../bug-fix/2026-07-29-atomic-web-image-admission.zh.md) 拥有本修复所修订的接收/选择串行边界。
