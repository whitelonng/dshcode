# vision/ — vision capability family

English | [中文](README.zh.md)

Image understanding for text-only models: the model-facing `describe_image` tool asks a vision-language model at an OpenAI-compatible endpoint to describe an image file or URL, and only the returned text crosses into the conversation.

| Package | Role | ctx key |
|---|---|---|
| [`tool-describe-image/`](tool-describe-image/README.md) | Registers the `describe_image` tool and owns its HTTP client, credential resolution, and security policy. | (registers on `ctx.tools`) |

The child README owns the tool contract, configuration, and rendering behavior.
