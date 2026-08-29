# `@deepseek-ai/dsh-file-reference`

English | [中文](README.zh.md)

File-reference discovery seam and browser-safe `@file` grammar shared by host-backed user interfaces. `ctx.fileReferences.list(agent, query, signal)` returns path-only file or directory candidates for the addressed agent; concrete providers own namespace access, ranking, caching, and invalidation. The same contract is remotely callable as the unary `fileReferences/list` Remote method (`@Remote` on the Service Definition, cancelled through the reserved trailing signal), so browser consumers call `ctx.remote.fileReferences.list` without an API Proxy route.

`activeAtToken()` recognizes an `@path` or open `@"path with spaces` token only at the start of input or after whitespace, so email-like text does not open completion. `formatFileMention()` emits the matching prompt spelling, appends `/` to directory candidates, preserves an explicitly opened quote, and rejects control characters or embedded quotes that the editor grammar cannot represent safely.

Selecting a candidate does not read or attach file contents. The exported `FILE_REFERENCE_PROMPT` is stable guidance that a provider may install when the addressed agent can call `read`.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-file-reference-local`, which conditionally contributes this package's stable file-reference guidance.

#### KV Cache effect

The interface and grammar add no request tokens themselves; a provider-owned prompt section determines cache behavior.

## Known Limitations and Deferred Work

- **Path candidates are advisory** — the seam does not prove that a later model-facing filesystem tool can access the same namespace; deployments must align the provider with the effective `read` implementation.
- **No file-content reference object** — selected files remain ordinary prompt text and require an explicit model tool call before their contents become model-visible.
