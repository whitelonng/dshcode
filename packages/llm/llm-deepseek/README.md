# @deepseek-ai/dsh-llm-deepseek

English | [中文](README.zh.md)

DeepSeek chat-completions adapter for the harness LLM seam: direct `fetch` + SSE (framed by `eventsource-parser`) translating the official wire format (source of truth: the API docs — guides/thinking_mode, guides/tool_calls, api/create-chat-completion) into the `StreamChunk` protocol.

A second, library-backed implementation of the same seam exists in `@deepseek-ai/dsh-llm-pi-ai`. This package owns the `deepseek-official` provider route — deliberately distinct from pi-ai's catalog name `deepseek`, so one composition can mount both DeepSeek paths side by side; registering another adapter for `deepseek-official` itself still throws `LlmError('DUPLICATE_ADAPTER')`.

The package root exposes the Cordis plugin contract and `DeepSeekAdapter`; wire serialization, SSE parsing, and chunk translation helpers are not part of that root contract.

## Config

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY  # default; resolved per request via ctx.credentials, then the environment
    baseURL: https://api.deepseek.com # optional; $DEEPSEEK_BASE_URL then the public API when omitted
    thinking: enabled        # optional; provider default is enabled
    reasoningEffort: high    # optional; off | low | high | max — omitted ⇒ high
    maxTokens: 256000        # optional positive per-request output cap; this is the default
    streamIdleTimeoutMs: 300000 # optional; positive finite Node timer delay; five-minute default
    maxRequestFilesBytes: 134217728 # optional positive integer; 128 MiB raw request-image default
    maxInlineRequestImageBytes: 20971520 # base64 fallback high watermark; 20 MiB default
    maxImagesPerRequest: 600       # provider request image-count limit
    imageOffloadByteQuantum: 67108864 # oldest-image removal advances in 64 MiB steps
    inlineImageOffloadByteQuantum: 10485760 # fallback removal advances in 10 MiB steps
    imageOffloadCountQuantum: 20      # count overflow advances in 20-image steps
    filesApiTimeoutMs: 60000           # per-image Files resolution deadline; one-minute default
    fileExpiresAfterSeconds: 604800   # uploaded image lifetime; 1 hour to 30 days
    fileRefreshMarginSeconds: 3600    # replace ids with less lifetime remaining
    fileQuotaCleanupBatch: 100        # oldest harness-owned files deleted before one quota retry
    retryPolicy:             # optional; omission uses normal mode with five retries
      mode: always           # normal | always
      backoff:
        initialDelayMs: 500
        maxDelayMs: 10000
        jitterRatio: 0.1
    defaultContextWindow: 1000000 # optional positive-integer fallback; this is the default
    models:                  # optional; defaults to V4 Flash, V4 Pro, and V4 Flash Vision Exp
      - id: deepseek-v4-flash
        name: DeepSeek-V4-Flash
      - id: deepseek-v4-flash-vision-exp
        name: DeepSeek-V4-Flash-Vision-Exp
        inputModalities: [text, image]
        imagePixelBudget: 640000
        imageMaxBytes: 1048576
      - id: private-reasoner
        description: Company-hosted reasoning model
        contextWindow: 512000
```

The plugin registers the single provider route `deepseek-official` together with its resolved `retryPolicy`; omission resolves to normal mode with five retries. A request selects it with `provider: deepseek-official`; its `model` is passed through as the wire `model` string, so changing DeepSeek models does not require lifecycle-time registration. Omitting `models` advertises `deepseek-v4-flash`, `deepseek-v4-pro`, and the image-capable `deepseek-v4-flash-vision-exp`, each with a 1,000,000-token context window; an explicit list replaces those defaults, while `models: []` advertises none. Catalog entries are exposed through `ctx.llm.listModels('deepseek-official')` for clients such as ACP editors and the Web selector, but remain advisory: unlisted model ids still pass through unchanged as text-only routes. An omitted entry name defaults to its id, and omitted `inputModalities` means `text` only.

An image-capable catalog entry declares `inputModalities: [text, image]` and may set `imagePixelBudget`, `imageMaxBytes`, or `imageDetail: low`. The ordinary default is 640,000 total pixels and 1MiB encoded bytes; low detail defaults to 512 by 512 total pixels. The attachment store scales by `min(1, sqrt(pixelBudget / (width * height)))` and rounds inward to keep the pixel count at or below the hard cap, so a 2048 by 1024 normalized attachment becomes about 1130 by 565 instead of a forced square. Request encoders run lazily: low-color images try PNG (palette only without alpha) then WebP 85 and 80, other alpha images try WebP 85 then 80, and other opaque images try JPEG 85 then 80; dimensions shrink only when both quality attempts exceed 1MiB. Concurrent generation of one `variantId` shares one transform. A caller can cancel its own wait without interrupting other waiters; the transform stops when no waiter remains. The adapter normally uploads the exact derived request bytes through `POST /files` and sends `{type: "file", file_id}` blocks. A failed or timed-out file-id resolution rebuilds the whole chat request with those same request versions as base64 data URLs; one request never mixes file ids and inline images. Every retained image is preceded by stable text naming the complete attachment id and actual request dimensions. User, tool-result, agent-loop, compaction, and direct `ctx.llm.stream` requests all use this projection. Text-only routes receive stable attachment placeholders while durable history keeps its image references.

`maxRequestFilesBytes` and `maxImagesPerRequest` bound the retained request versions at 128MiB and 600 images by default. The byte and count quanta must not exceed their corresponding bounds. Before attachment reads, the adapter uses each route's request-version byte cap as a conservative upper bound and removes the oldest over-budget prefix; only retained normalized attachments are read and transformed. Exact derived lengths are checked again without restoring omitted images. When the byte bound is crossed, the oldest prefix advances past the next 64MiB boundary; 129 one-megabyte images remove the oldest 65 and retain 64MiB, and that prefix stays unchanged until durable history exceeds 192MiB. Count overflow advances independently in `imageOffloadCountQuantum` steps. Removed images become the fixed model-visible placeholder `[image omitted to keep the request within its image limit; older images are omitted first. If this image is still needed, read its file again when a path is available; otherwise ask the user to attach it again.]`. This high-watermark projection avoids changing an old request prefix after every new image.

Inline fallback has an independent base64 budget. `maxInlineRequestImageBytes` defaults to 20MiB and `inlineImageOffloadByteQuantum` to 10MiB, so a history of 21 one-megabyte base64 payloads removes the oldest 11 and retains 10MiB. The calculation uses base64-expanded lengths. The prepared request versions are reused byte-for-byte; fallback does not decode or compress an image again. Successful mappings created before a later image fails remain indexed for future requests.

Uploaded ids are indexed below `DSH_HOME` by endpoint/API-key scope and request `variantId`. The variant covers the normalized attachment id, transform version, route pixel and byte budgets, and encoder parameters, so Files API and inline fallback refer to the same deterministic bytes. Uploads request a seven-day lifetime by default and store the server's `expires_at`. A local mapping with no more than one hour remaining is replaced before use; the adapter does not retrieve every remote file before chat. If chat reports expired, deleted, missing, or invalid file ids and names one or more ids used by the request, the adapter removes exactly those mappings. If the provider identifies stale file state without naming an id, it removes every file mapping used by that chat attempt. It then uploads the affected request versions again and retries chat once. A second stale-file rejection clears the mappings identified by that response and is returned without a third chat attempt. An upload response without a complete file object, matching byte count, and `expires_at` is never indexed; a later request therefore uploads again instead of trusting inconsistent local state. A malformed local upload index is treated as an empty cache and replaced by the next successful upload. File resolution, including local index access and remote upload, has a per-image one-minute deadline by default. The default five-minute stream idle deadline therefore leaves time for inline fallback; a deployment may configure a shorter stream idle deadline when it wants that outer deadline to terminate the request first. Each successful resolution refreshes the outer idle watchdog. Any resolution failure switches that request to inline mode, while explicit public file-management operations continue to report their own failures.

Concurrent resolution of one scoped `variantId` shares one Files upload with waiter-local cancellation. One quota upload failure first paginates and collects the configured number of oldest `dsh-` files, then deletes that set before one upload retry. `DeepSeekFilesClient.delete`, `DeepSeekFileStore.release`, and `releaseAll` expose explicit remote-space reclamation. The current provider limits represented by this package are 128MiB per Files upload, 32MiB per chat-referenced image, 10,000 stored files, and 25GiB per API key; the default 1MiB request version remains below the two per-file limits.

`contextWindow` is optional per configured model and is not exposed through the advisory catalog. `ctx.llm.resolveModelInfo('deepseek-official', model).context` returns an exact model value first, then `defaultContextWindow` for an entry without capacity or an unlisted pass-through id. The adapter default is 1,000,000; pressure-sensitive plugins therefore get deployment-owned capacity without treating the model selector as authoritative. Registering another adapter for `deepseek-official` throws `LlmError('DUPLICATE_ADAPTER')`.

`maxTokens` is the adapter-configured output cap for conversation requests and defaults to 256,000. A catalog entry may carry its own `maxTokens`, which wins for that model; an entry without one, and any unlisted pass-through id, resolve to the profile value, so adding a per-model cap changes one model rather than the route. Exact-model resolution exposes the winner as `defaultMaxTokens`; `LlmRuntime` materializes that value into `GenerateOptions.maxTokens` before the agent loop writes `request/header`, so the wire request remains reconstructable. An explicit request or `AgentOptions.maxTokens` value wins and is serialized as `max_tokens`. The adapter does not clamp this request budget against `contextWindow`; deployments with a smaller context or provider output limit must configure a compatible `maxTokens`.

The same exact-model result exposes ordered `off`, `low`, `high`, and `max` efforts under `reasoning` for every pass-through model when deployment policy permits thinking. `reasoningEffort` selects the deployment default and falls back to `high` when omitted. `agent/request` can replace it on each conversation step; the resolved value is logged in `request/header`. `low`, `high`, and `max` enable thinking and serialize as the same official top-level `reasoning_effort` value; adapter-owned `off` instead serializes `thinking.type: disabled` and omits `reasoning_effort`. An unsupported value fails with `UNSUPPORTED_REASONING_EFFORT` before network I/O.

`thinking: disabled` is a deployment lock that publishes only `off` with `off` as its default. Omitting `reasoningEffort` or configuring it as `off` is valid; configuring `low`, `high`, or `max` fails plugin loading, and a direct per-request attempt to enable thinking fails before network I/O. A request with `GenerateOptions.purpose: 'session-title'` also forces thinking disabled and omits the already-resolved effort, reserving its bounded output for visible title text without changing conversation or compaction defaults.

`streamIdleTimeoutMs` bounds each outstanding provider read, including the initial `fetch`, without counting time the consumer spends between chunks. DeepSeek SSE comments and successful file resolutions rearm an outstanding read as transport activity but never become `StreamChunk` values or session-log events. One stable abort signal reaches the request and body reader for the whole call; expiry stops the transport and throws `LlmError('TIMEOUT')`, while an earlier caller abort throws `LlmError('ABORTED')`. The adapter normally makes one chat request per `stream()` call and makes a second only for stale-file recovery. A file-resolution failure before the first chat sends one inline request. If replacement resolution fails after a stale-file response, the inline request is the one permitted retry. It registers the configured retry policy as provider metadata, and `dsh-llm-retry` separately executes that policy at durable agent-step boundaries.

## Dynamic configuration (settings + credentials)

Connection facts are not frozen at load. `resolveAdapterOptions` is the one explicit resolve step from raw config to validated facts, and the adapter re-reads them through a thunk **once per operation**: base URL, catalog, request defaults, image and Files policies, and idle budget all take effect on the next request, while an in-flight stream keeps the facts it started with. Three optional seams feed that thunk:

- **`ctx.settings`** — the plugin registers the `llm-deepseek` namespace with this same `Config` schema and its `cordis.yml` entry as the composition `base`, so a `llm-deepseek:` section in the user settings document overrides any field without a restart. Without a mounted settings service the entry config alone drives the adapter, unchanged. A live settings snapshot that passes the schema but fails a beyond-schema bound (a duplicate catalog id, a broken thinking/effort pair) keeps the last good facts and logs the failure; the entry config itself still fails plugin load.
- **`ctx.credentials`** — the API key resolves per stream call, from the *same* resolved snapshot that supplies the endpoint. Configuration carries only `apiKeyEnv`, never a literal key: the reference resolves through the credential seam, and without a mounted seam through the trusted environment layers. Because credential facts travel with the connection facts, a settings snapshot the resolver rejects contributes neither its endpoint nor its key: the whole previous generation keeps serving. Every resolved key is format-checked before use, so a value no HTTP header can carry is refused with `LlmError('INVALID_CREDENTIAL')` naming the failing entry point — never any part of the key — instead of surfacing as an opaque `fetch` `TypeError`. A request with no key anywhere fails with `MISSING_CREDENTIAL` naming every configuration entry point, while the route stays registered and the catalog stays browsable — first-run onboarding is "browse models, store the key, prompt again", with no restart between.
- **`ctx.attachments`** — image requests resolve this service at request time, so Cordis load order does not freeze optional image availability. Absence rejects image input with `UNSUPPORTED_CONTENT`; text-only calls do not require the service.

The one registration-captured fact is the retry policy: when its resolved value changes, the plugin re-registers the route in place (same adapter instance, one synchronous section), so `ctx.llm.providerRetryPolicy('deepseek-official')` always reports the current policy.

The plugin also declares its route in the configurable-provider directory (`ctx.llm.listConfigurableProviders()`): provider `deepseek-official`, settings namespace `llm-deepseek`, empty settings path — the whole section is the profile. Configuration surfaces use that entry to offer this adapter alongside dormant pi-ai providers.

## App attribution

Every chat and Files API request carries the shared attribution header from dsh-llm's `attributionHeaders()`, the mandatory `User-Agent` baseline identifying the harness (see [dsh-llm § App attribution](../llm/README.md#app-attribution-attributionts)). Direct DeepSeek requests and OpenAI-compatible gateway requests get no provider-specific app-attribution headers under this adapter contract; OpenRouter app attribution is deferred to a future explicit OpenRouter adapter or mode. A request whose `GenerateOptions.purpose` is `compaction` (dsh-compaction-basic's auxiliary summarization call) additionally carries `x-deepseek-harness-compact: 1`, so the host can separate compaction traffic from conversation requests.

DeepSeek request identity is separate from app attribution. After credential resolution, every provider request carries `x-deepseek-harness-user-id` with the stable anonymous id from [`@deepseek-ai/dsh-anonymous-user-id`](../../identity/anonymous-user-id/README.md); a request carrying `GenerateOptions.sessionId` also sends that exact value as `x-deepseek-harness-session-id`, while a direct call without a session omits the session header. Both headers go to the resolved `baseURL`, including a configured gateway, and remain outside the request body and model-visible content.

## Wire-format notes

- Streaming only (`stream_options.include_usage` always on). `usage` may arrive attached to the finish chunk or as a trailing usage-only chunk — the translator defers both to `[DONE]`, so `usage` always precedes `finish` and nothing follows `finish`.
- The adapter-owned `off` effort maps to `thinking: {type: 'disabled'}` and never crosses the wire as `reasoning_effort: 'off'`.
- The first thinking-mode chunk carries `reasoning_content: ""` — handled (no spurious reasoning block).
- **Reasoning passback rule**: every assistant turn that carried reasoning serializes `reasoning_content` back in history. Thinking mode requires it on tool-call turns; DeepSeek ignores it elsewhere, while a gateway re-encoding the conversation for another vendor recovers that turn's upstream thinking signature by hashing the replayed text.
- Image-capable user messages preserve text/image order. Tool-role content remains a string; consecutive tool-result images are grouped into the following user message with `Attached image(s) from tool result:`.
- Cache accounting: `cacheReadTokens` ← `prompt_cache_hit_tokens` / `prompt_tokens_details.cached_tokens`; DeepSeek reports no cache-write metric.

## Errors

Non-2xx responses throw `LlmError` with stable codes: `AUTH` (401/403), `QUOTA` (a response whose provider details identify exhausted quota, balance, or credits), `RATE_LIMIT` (other 429s), `CONTEXT_WINDOW_EXCEEDED` (a 400 whose provider code, type, or message identifies context overflow), `INVALID_REQUEST` (other 400s and 413), `SERVER` (5xx), `HTTP_<status>` otherwise. Its serializable `failure` retains the HTTP status plus a valid positive `Retry-After` seconds/date delay and `x-request-id` / `x-deepseek-request-id` when present. If DeepSeek rejects a normalized image, the primary message names the attachment or display name, durable message and image position, normalized media type, 8-bit sRGB/sRGBA depth, dimensions, and provider message. With several candidates and no file id in the provider detail, it lists each possible image instead of assigning the failure to the first one. The raw response remains the error `cause`; it is never the only user-visible diagnostic. Attachment reads retain their stable attachment failure code rather than becoming transport failures. A pre-response transport failure (DNS, refused connection, TLS, proxy) throws `TRANSPORT` naming the configured endpoint and chaining the original rejection as `cause`; caller aborts throw `ABORTED`, and the loop's cancellation signal remains authoritative. Protocol violations throw `STREAM_CLOSED` (no `[DONE]`) or `MALFORMED_RESPONSE` (bad JSON payload). Unknown wire `finish_reason`s (e.g. `content_filter`, `insufficient_system_resource`) become `finish {kind: 'error', failure}` chunks, and a completed stream whose `stop` (or absent) finish opened no content blocks becomes a `finish {kind: 'error'}` with code `EMPTY_RESPONSE` (retried by default policy).

## Model Experience

### DeepSeek request

#### What the model sees

The selected DeepSeek model receives the harness system prompt, message history, tool schemas, stop sequences, and call config. The vision model normally receives retained user and tool-result images as Files API references beside stable attachment handles and request-image dimensions; a Files resolution failure sends all retained images as inline data URLs instead. An over-budget older image is represented by the documented placeholder. Reasoning content from a prior assistant turn is passed back verbatim, whether or not that turn called a tool.

#### Token effect

Provider tokenization governs exact text and image-token input. Reasoning passback carries every reasoned turn's chain of thought into later requests, while dropping over-budget images avoids paying those tokens again; cache-read usage is reported when available.

#### KV Cache effect

An unchanged assembled prefix, including deterministically encoded retained images and placeholders, is eligible for DeepSeek cache reuse, which this adapter reports in usage. A model-route change or any upstream prompt, schema, prefix, history, or image-budget change may prevent reuse from the first changed token; reasoning passback appends on every reasoned turn.

### DeepSeek response

#### What the model sees

Reasoning, text, and raw-string tool arguments are translated into harness chunks for the loop to log and assemble.

#### Token effect

Generated tokens follow the request's logged reasoning effort and `maxTokens`; only loop-retained blocks affect later input.

#### KV Cache effect

Loop-retained response blocks append to the next request and preserve its earlier reusable prefix; dropped blocks have no later cache effect. Changing the provider or model selects a different cache domain.

## Known Limitations and Deferred Work

- **A settings `models` list replaces the composition list wholesale** — settings-layer merging is per-field, and arrays are one field; per-entry catalog merging would need a keyed shape.
- **`tool_choice` is not mapped** — not part of the core vocabulary (MVP cut, shared with the pi-ai twin).
- **Requests use raw `fetch`, not `@cordisjs/plugin-http`** — no shared proxy/interception configuration; adoption is deferred until a second adapter wants it (`TODO(http)`).
- **Plugin-added content block types are skipped** — core text and supported image blocks are serialized, and empty tool output crosses the wire as the literal `(no output)`.
- **Images are input-only durable attachments** — direct external URLs and assistant image output are not supported; DeepSeek input normally uses the Files API and uses inline base64 only for per-request recovery.
