---
description: "The describe_image tool: gives a text-only model image understanding through an OpenAI-compatible vision-language endpoint, owning the model-facing contract, the HTTP client, and its security policy."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-describe-image

English | [中文](README.zh.md)

## Summary

**DeepSeek Harness image-understanding plugin** — the `describe_image` tool that gives a text-only model vision via an OpenAI-compatible VLM endpoint (image understanding · multimodal · vision-language model). The model-facing `describe_image` tool asks a vision-language model at an OpenAI-compatible endpoint to describe one image. The image — a local file path, an http(s) URL, or a durable attachment reference — never enters the conversation: the tool returns only the vision model's text answer, which flows through the ordinary tool-result path. This package owns the model-facing contract (tool name, JSON schemas, argument names, canonical value, result rendering, and the `generic`/`read` call card) plus the HTTP client and its security policy; there is no replaceable provider seam — the endpoint, model, and credential are this plugin's own config.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install the plugin into a profile and let it register the `describe_image` tool once at load; there is no per-call model or endpoint argument, so the model cannot route an image to a different backend than the deployment configured.

### When to choose it

Choose this package when a text-only model needs image understanding through a deployment-configured OpenAI-compatible endpoint, and when the caller wants the vision answer but never wants the image bytes itself to cross into the conversation. Skip it for a deployment with no vision endpoint, or for work that needs iterative look-decide-look or pixel-precise UI control — that belongs in a vision-model subagent, not this tool.

### Minimal configuration

Install the plugin and declare its `baseURL`, `model`, and credential:

```sh
dsh plugin --profile web add github:whitelonng/dsh-plugin-describe-image
```

The tool table and the config fields:

| Tool | Args | Behavior |
|---|---|---|
| `describe_image` | `image` (string), `prompt?` (string) | Loads the image — a local absolute path, an http(s) URL fetched with redirects refused, or the JSON of an `[image attachment …]` note, resolved through the attachment service — sniffs PNG/JPEG/GIF/WebP by magic bytes, enforces the `maxBytes` bound, and asks the configured vision model for a description — the `prompt`, or `defaultPrompt` when omitted. Returns `{ text, model, image, mimeType, bytes }`; the model sees only `text`. |

| Key | Default | Meaning |
|---|---|---|
| `baseURL` | — (required) | Root of the OpenAI-compatible endpoint (e.g. `https://dashscope.aliyuncs.com/compatible-mode/v1`); trailing slashes are stripped. |
| `model` | — (required) | Vision model id for the configured endpoint. |
| `apiKey` | — | Inline API key. Convenience for local setups; the value sits plaintext in the composition file. Feed it from the environment via `!!js process.env.VISION_API_KEY` instead of pasting a literal. |
| `apiKeyEnv` | `VISION_API_KEY` | Credential reference (environment-variable name) the key resolves through; an empty string disables reference resolution. |
| `defaultPrompt` | See source | Instruction sent when a call omits `prompt`. |
| `maxBytes` | `10485760` | Upper bound on image bytes for local files and downloads alike. |
| `maxOutputTokens` | `1024` | Output-token cap sent as `max_tokens`. |
| `timeoutMs` | `60000` | Per-call vision request timeout. |

```yaml
- id: describe-image
  name: '@deepseek-ai/dsh-tool-describe-image'
  config:
    baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
    model: qwen-vl-max
    apiKey: !!js process.env.VISION_API_KEY
```

The desktop app's plugin list accepts the same spec in its install box; the plugin loads after an application restart. The tool is registered once at load.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The API key resolves per call, first matching source wins: an explicit `apiKey`, then the [credential seam](../../credentials/README.md) resolving `apiKeyEnv` (which owns environment, `.env`, and managed-store layers), then — only when the seam is not composed — the launch environment. A call without any key fails with a `no API key` error, never at plugin load, so a key stored later reaches the next call without a restart. Misconfigured endpoints and bounds fail loud at load. Every field is also editable live from the Web GUI's Settings → Plugins → "Image understanding" card, which writes the `describe-image` settings section; committed changes reach the very next call. The card's API key control addresses the credentials seam — the literal never rides a settings response.

The vision request and the image download both refuse HTTP redirects (`redirect: 'error'`), so the bearer credential and the image bytes can never be forwarded to an origin the deployment did not configure. Request bodies carry the base64 image but never the key; nothing logs request headers or the resolved credential. Error excerpts are bounded to 200 characters. Only `http(s)` URLs and local paths are accepted; other URL schemes are rejected. The response body is bounded (`maxOutputTokens * 8 + 64 KiB`) before parsing.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tool catalog](../../../docs/tool-catalog.md)
- [Credentials seam](../../../packages/credentials/README.md)
- [Adding a package with a tool](../../../docs/cookbook/adding-a-package.md)

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The generated [`describe_image` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-describe-image). The description states the accepted media types and the `maxBytes` bound; deployment endpoints, credential names, and timeouts are not model-facing.

#### Token effect

Fixed schema cost per request while the tool is registered.

#### KV Cache effect

Prefix-stable while the schema and description are unchanged; plugin lifecycle or config changes that alter the description may invalidate reuse from the first changed schema token.

### Result

#### What the model sees

Exactly the vision model's `text` answer, rendered as a plain text block. Failure results carry a `describe-image:`-prefixed message (bound rejection, media type, HTTP status with bounded excerpt, abort, timeout, or missing credential).

#### Token effect

Data-dependent results are resent until compaction; the tool itself adds no persistent prompt sections.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Header-only validation** — the magic-byte gate detects the media type but does not decode the image; a file with a valid header and a corrupt payload fails at the vision endpoint, not at this tool.
- **One image, one answer** — no multi-image input, no follow-up questions on a previous image, and no structured output (coordinates, bounding boxes). Work that needs iterative look-decide-look or pixel-precise UI control belongs in a vision-model subagent, not this tool.
- **Text extraction still costs a VLM call** — no local OCR fallback; deployments that only need text can point `baseURL` at a cheaper OCR-first model (or a local Ollama endpoint).
- **OpenAI-compatible contract only** — providers whose chat-completions request or response shape differs need a separate tool or adapter; the wire format is fixed in source.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
