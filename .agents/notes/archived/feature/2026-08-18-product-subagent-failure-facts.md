# Agent Note: Product subagents expose bounded structured failure facts

Status: implemented
Archived: 2026-08-21

English | [中文](2026-08-18-product-subagent-failure-facts.zh.md)

## Problem

The [Claude Code and Codex product providers](2026-08-04-claude-code-and-codex-subagent-backends.md) receive structured product failures, but a published run historically flattened most of them to the shared `error` stop reason. Product logs retained detail that the foreground parent and a [one-shot background Job](2026-08-12-product-subagent-one-shot-background-tasks.md) could not use to distinguish a product limit, an execution failure, or an early process exit.

Copying SDK error text, app-server payloads, or stderr into the result would expose task text, paths, environment values, credentials, or product internals. Adding shared error fields would also make the provider-neutral [subagent seam](2026-06-21-subagent-capability-seam.md) own product version vocabularies that change independently.

## Decision

Each product Provider owns the mapping from its pinned official structured failures, current operation, and managed process outcome to one fixed safe diagnostic line. `SubagentResult` remains unchanged: consumers receive the existing bounded `diagnostic` string and do not parse its product-private fields. The [minimal-diagnostics decision](../simplification/2026-08-21-product-subagent-minimal-diagnostics.md) supersedes this note's complete Claude Code subtype mirror; this note continues to own the current detailed Codex categories until that provider adopts the same simplification.

### Safe diagnostic

The structured line has this fixed order:

```text
Product subagent failure (product: <product>; stage: <stage>; category: <category>; HTTP status: <status>; exit code: <code>; signal: <signal>)
```

The Provider omits unavailable optional fields. Exit code and signal are independent facts and are each retained when observed. A contributing permission decision from the [non-interactive permissions decision](2026-08-15-product-subagent-noninteractive-permissions.md) follows the structured line; the latest safe permission fact remains operation-local. The shared result boundary limits the complete text to 4096 UTF-8 bytes.

Successful results and local cancellation expose no failure fact. Raw product errors, stderr, tool input, paths, environment values, credentials, and protocol payloads never enter the diagnostic. Startup and cleanup rejections use the same safe line in their Error message. Original failures remain on internal cause chains; Provider Host logs and forwarded stderr remain product-local observation only.

### Claude Code facts

The [minimal-diagnostics decision](../simplification/2026-08-21-product-subagent-minimal-diagnostics.md) exclusively owns Claude Code categories, stages, process facts, permission ordering, and verification for Agent SDK 0.3.241 and Claude Code 2.1.241. This note carries no separate Claude category contract.

### Codex facts

Codex app-server 0.147.0 defines eleven string categories and five object variants. The Provider preserves `contextWindowExceeded`, `sessionBudgetExceeded`, `usageLimitExceeded`, `serverOverloaded`, `cyberPolicy`, `internalServerError`, `unauthorized`, `badRequest`, `threadRollbackFailed`, `sandboxError`, and `other`. It also preserves `httpConnectionFailed`, `responseStreamConnectionFailed`, `responseStreamDisconnected`, `responseTooManyFailedAttempts`, and `activeTurnNotSteerable`; the four connection/stream variants retain numeric `httpStatusCode`, while the active-turn variant does not expose `turnKind`. Unknown strings, objects with another variant set, malformed values, and unclassified exceptions use `unknown`.

| Stage | Owned operation | Observable failure |
| --- | --- | --- |
| `initialize` | App-server spawn and initialize/initialized handshake | `start()` rejects with fixed safe facts and any process outcome already observed |
| `thread-start` | Ephemeral `thread/start` request and response validation | `start()` rejects with the thread stage and any available process outcome |
| `turn-start` | Published `turn/start` request, provisional ids, and early frames | The run resolves as `error` with a safe unknown fallback when no structured category exists |
| `turn` | Terminal notification, final-answer selection, and error-info mapping | The complete category and optional HTTP status reach the non-completed result |
| `process` | Managed app-server exits before another terminal path settles | The run resolves as `error` with `process-exit` and any available code and signal |
| `teardown` | Wire close and process-tree release | `dispose()` rejects independently; startup rollback aggregation exposes both startup and teardown lines |

`contextWindowExceeded` remains `max-tokens`; every other known or unknown Codex category remains `error`, and `cyberPolicy` does not become `refusal`.

### Ownership and lifecycle

| Fact or resource | Owner | Consumer behavior |
| --- | --- | --- |
| Codex error category | Codex Provider over its pinned official app-server | The Provider preserves its current structured category and uses `unknown` outside the recognized set |
| Current failure stage | Product Provider operation | Derived at the failure site; never persisted or used as a recovery state |
| Exit code and signal | `dsh-subprocess` process handle | The Provider displays observed values without inferring missing ones |
| Diagnostic bytes and delivery | `dsh-subagent`, foreground tool, and Job runtime | The same bounded text is presented separately from assistant output in both scheduling modes |
| Raw product failure | Product runtime, internal cause chain, and Host observation | It remains internal and never becomes model-visible result text |

## Verification

Claude Code verification is owned by the [minimal-diagnostics decision](../simplification/2026-08-21-product-subagent-minimal-diagnostics.md). Codex package tests pin all sixteen current error-info variants, HTTP status presence and absence, all six stages, unknown fallback, stop-reason preservation, permission ordering, sanitization, cancellation, concurrency, and cleanup aggregation. The real app-server fixture produces an actual Codex `internalServerError` and covers process/protocol failure and whole-tree quiescence. The keyless ACP snapshot records the Codex diagnostic in foreground error output, a background completion notice, and `job_output`.

## Alternatives considered

**Return raw SDK errors, app-server payloads, or stderr.** These values can contain commands, paths, workspace content, environment values, credentials, or upstream prose. A fixed allowlisted mapping preserves actionable facts without expanding the model-visible trust boundary.

**Add a shared product-error enum or structured result fields.** Claude Code and Codex version their error unions independently. A shared enum would duplicate those authorities and force unrelated Providers and consumers to track product releases.

**Parse generic stderr and exception messages.** Free-form text is neither stable nor safe. Only pinned structured product fields and the managed process outcome qualify as diagnostic input.

**Persist stages or add a recovery controller.** The stage is derived from the current call site only when a failure is reported. Persistence, retries, resume, and remediation need separate ownership and user contracts.

**Map product limits to new shared stop reasons.** Claude Code turn and budget limits are not token-window exhaustion, and an error category does not establish refusal semantics. Existing stop reasons remain unchanged.

## Consequences

The parent can distinguish the current Codex budget, usage, service, policy, request, connection, stream, rollback, sandbox, and active-turn categories without receiving raw product text. The [minimal-diagnostics decision](../simplification/2026-08-21-product-subagent-minimal-diagnostics.md) owns the corresponding Claude result. Foreground and background scheduling preserve the same fact because both consume one `SubagentResult`.

The diagnostic is display text rather than a new public protocol. Callers may present it but must not branch on its punctuation or product-private category names. A pinned product-version upgrade revalidates the Provider mapping and evidence without requiring every official error member to remain model-visible.

This decision adds no product session persistence, retry policy, recovery state, stderr classifier, authentication or configuration taxonomy, progress stream, or human interaction path.
