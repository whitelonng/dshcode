---
description: "为纯文本模型提供图像理解：面向模型的 describe_image 工具把图片交给 OpenAI 兼容端点的视觉语言模型描述，跨入对话的只有返回的文本。"
kind: "package-group"
---

# vision/ — 视觉能力家族

[English](README.md) | 中文

为纯文本模型提供图像理解：面向模型的 `describe_image` 工具把图片文件或 URL 交给 OpenAI 兼容端点的视觉语言模型描述，跨入对话的只有返回的文本。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`tool-describe-image/`](tool-describe-image/README.zh.md) | 注册 `describe_image` 工具，拥有其 HTTP 客户端、凭据解析与安全策略。 | （注册于 `ctx.tools`） |

子 README 拥有工具契约、配置与渲染行为。
