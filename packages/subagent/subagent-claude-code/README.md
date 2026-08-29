# @deepseek-ai/dsh-subagent-claude-code

English | [中文](README.zh.md)

This package registers a Profile-named Claude Code subagent provider whose default name is `claude-code`. Each accepted run invokes the official Claude Agent SDK in the delegating Session's workspace, lets the pinned SDK select its installed platform CLI, submits one self-contained text task, and returns either the strict final answer or a separate safe failure diagnostic through the shared [`dsh-subagent`](../subagent/README.md) result contract.

## Start and ownership

`start(request)` accepts only a non-empty sequence of text blocks and derives the child cwd from the parent Session. It creates one private `AbortController`, calls the official SDK `query()`, and publishes the run only after the SDK's `spawnClaudeCodeProcess` hook has supplied a live CLI handle owned by [`dsh-subprocess`](../../subprocess/subprocess/README.md). A failure or cancellation before publication closes the query, terminates any acquired process tree, waits for it to exit, and rejects `start()`.

The SDK receives the exact concatenated text task. The provider iterates the complete SDK message stream and accepts only a `result` message with `subtype: "success"`, `is_error: false`, and a nonblank `result`, followed by normal iterator completion. Every failure still maps to `error`: the four error subtypes in Agent SDK 0.3.220 retain their exact category, an error-marked or blank success becomes `invalid-success`, a missing result becomes `missing-result`, an unclassified query failure becomes `unknown`, and an early CLI exit becomes `process-exit`. The diagnostic also names the current `query-start`, `query-run`, `process`, or `teardown` stage and independently includes an observed exit code and signal. The provider produces neither `max-tokens` nor `refusal`.

Local cancellation wins the result race and maps to `aborted` without a failure diagnostic. `dispose()` is idempotent: it aborts the run, asks the SDK query to close, invokes the shared process-tree termination escalation, and waits for whole-tree exit. SDK graceful close expresses protocol intent; the subprocess handle remains the authority for process quiescence. Startup and teardown rejections expose the same fixed safe stage and process facts through their Error message, while the original product or Host error remains on the internal cause chain and in the Provider's Host log. Result failure and independent teardown failure remain separate.

## Native settings and interaction

The provider deliberately omits the SDK `settingSources` option. The official SDK therefore reads the host's normal user, project, and local Claude settings relative to the parent Session cwd, including native account state and product configuration. The provider neither copies nor filters those files and does not create or modify login state. The Profile-selected `permissionMode` is the one query-level override: Claude Code still owns its settings and sandbox, while the selected native mode decides how this unattended query handles permission checks.

Each query sets `persistSession: false` and disables `AskUserQuestion`. Except in bypass mode, `canUseTool` immediately denies requests that still require human approval. Plan mode also places `ExitPlanMode` in the SDK's `disallowedTools`, so native settings cannot pre-approve a transition back to execution and the model must return the completed plan as its final answer. MCP elicitation is declined, the known refusal fallback dialog is cancelled, and undeclared dialog kinds use the SDK's no-dialog failure behavior. These decisions never wait for a user interface. When both facts contribute to a failed run, `SubagentResult.diagnostic` contains the structured failure line first and the latest safe permission decision second; the shared result boundary limits the complete text to 4096 UTF-8 bytes. Successful and locally cancelled runs expose neither captured fact.

## Capabilities and context

The provider advertises no optional start-time capabilities and reports `inheritsParentContext: false`. Claude Code receives the standalone text task and the parent Session cwd, but not the parent conversation, persona, tool filter, depth policy, or structured-output contract. Every run has an independent SDK query, cancellation controller, CLI process, and non-persisted product session.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `providerName` | `claude-code` | Non-empty registry name on `ctx.subagents`; each mounted instance needs a unique value. |
| `env` | `{}` | Explicit SDK/CLI environment layered over the shared credential-scrubbed parent environment. |
| `permissionMode` | `dontAsk` | Native non-interactive permission policy fixed for every run from this Provider instance. |
| `disposeGraceMs` | `3000` | Positive finite grace in milliseconds, no greater than [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md), between the shared process-tree owner's termination tiers; disposal then waits for whole-tree exit. |

| `permissionMode` value | Native behavior |
|---|---|
| `dontAsk` | Deny operations that are not already authorized instead of prompting. |
| `acceptEdits` | Accept file edits; any remaining permission prompt is denied by the unattended callback. |
| `auto` | Let Claude Code's native classifier allow or deny permission requests. |
| `plan` | Run in native planning mode, deny execution approval, and return the completed plan as the final answer. |
| `bypassPermissions` | Explicitly set the SDK's dangerous confirmation and bypass permission checks. |

Production omits `pathToClaudeCodeExecutable`, so Agent SDK 0.3.220 selects the matching native `claude` or `claude.exe` from its own platform package and passes that absolute command through the custom-spawn hook to `dsh-subprocess`. The provider does not inspect `PATH`, implement platform selection, or fall back to a host `claude`. Native settings and authentication remain authoritative, while `permissionMode` is the only query-level policy override. The plugin does not select a model, create a product home, log in, or probe an account. Credential-shaped ambient variables are removed before the explicit `env` overlay is applied, so an API key or token intended for the child must be supplied there. Non-credential endpoint variables such as `ANTHROPIC_BASE_URL`, along with ordinary ambient values such as `PATH` and `HOME`, remain inherited unless overridden; `PATH` does not choose the Claude executable.

This package is an optional Profile Bundle. Install it into the target Profile, then restart that Profile; installation brings the pinned Agent SDK and one compatible platform CLI payload into that Profile, while the declared `cordis.patch.yml` layer registers only the dormant `claude-code` Host provider and starts no Claude process. Removing the package withdraws that provider and its private runtime closure on the next Profile start.

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-claude-code
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-claude-code
dsh --profile <name>
```

Installation controls Host availability, not model permission. The Bundle supplies the dormant default `claude-code` row; the Profile may replace that row's complete config or mount additional rows with distinct `providerName`, `permissionMode`, and `env` values. Loading an instance starts no Claude process until a bound tool calls it. Each `dsh-tool-subagent` row names one provider and needs its own `toolName`, so the model sees static tools rather than a dynamic provider selector. Full Agent Presets carry a matching default product tool row with `disabled: true`; copy a preset and remove that field to expose `subagent_claude_code` only to agents composed from the copy. Its `one-shot` policy keeps omitted or `false` `run_in_background` calls in the foreground, while explicit `true` returns a parent-owned Job id for `job_output` or `job_kill`. The base host and full presets already provide the generic Job registry and controls.

The standalone composition below shows the complete explicit capability. A Profile based on `@deepseek-ai/dsh-base` keeps its existing Job rows, adds the product provider and tool rows, and does not mount duplicate Job services.

```yaml
- id: subagent-claude-safe
  name: '@deepseek-ai/dsh-subagent-claude-code'
  config:
    providerName: claude-safe
    permissionMode: dontAsk
    env:
      ANTHROPIC_API_KEY: !!js process.env.ANTHROPIC_API_KEY

- id: subagent-claude-bypass
  name: '@deepseek-ai/dsh-subagent-claude-code'
  config:
    providerName: claude-bypass
    permissionMode: bypassPermissions
    env:
      ANTHROPIC_API_KEY: !!js process.env.ANTHROPIC_API_KEY
```

```yaml
- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

- id: tool-subagent-claude-safe
  name: '@deepseek-ai/dsh-tool-subagent'
  disabled: true
  config:
    provider: claude-safe
    toolName: subagent_claude_safe
    backgroundMode: one-shot
    maxDepth: provider-managed

- id: tool-subagent-claude-bypass
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: claude-bypass
    toolName: subagent_claude_bypass
    backgroundMode: one-shot
    maxDepth: provider-managed
```

## Product compatibility and evidence

The runtime dependency is pinned to `@anthropic-ai/claude-agent-sdk@0.3.220`, whose eight platform packages carry Claude Code 2.1.220. A normal install selects one payload for the current OS, CPU, and Linux libc. For the current darwin-arm64 payload, `npm pack --dry-run --json` reports 74,858,812 packed bytes and 256,908,856 unpacked bytes; other platforms may differ, and these values are disclosure rather than an installation threshold. The keyless real-product test runs the SDK-selected CLI against a loopback Messages fixture and asserts that the shared subprocess argv begins with that platform package's native executable. Loader composition proves that installing the Bundle registers only the dormant Claude Code provider and starts no product process.

Installing with optional dependencies omitted, using an unsupported platform, or losing the selected payload leaves provider registration dormant but makes the first delegation fail at the SDK startup boundary. The caller receives the safe `query-start` / `unknown` failure fact; the native payload error remains only on the internal cause chain and in the Provider's Host log. The provider neither probes a host CLI nor retries with one.

Loader composition proves that the Bundle default, two additional named Claude instances, and the existing Codex package coexist without starting either product.

The project owner's identity-scoped distribution authorization covers the official SDK and the official CLI/platform payloads declared by each SDK version. [`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md) discloses the current optional payload closure without classifying its declared terms as permissive; unrelated non-permissive runtime dependencies continue to fail the notices gate.

## Model Experience

### Child request

#### What the model sees

The Claude Code child receives the standalone text task as one fresh SDK query. Its workspace is the parent Session cwd; its model, system instructions, tools, sandbox, and authentication come from native Claude settings, the selected Provider instance's Profile configuration fixes the query's environment and non-interactive permission mode, and the executable version comes from the Bundle's pinned SDK platform payload.

#### Token effect

The child pays for an independent Claude Code context and query. Child tokens do not enter the parent's context.

#### KV Cache effect

Independent of the parent request cache. Reuse depends only on Claude Code's own model, instructions, tools, native settings, and fresh query.

### Parent scheduling and results, indirectly

#### What the model sees

Through `dsh-tool-subagent`, a foreground call gives the parent the strict final Claude Code answer or an error containing the stop reason and optional safe diagnostic for a non-completed result. That diagnostic can distinguish the fixed SDK error category, lifecycle stage, and observed process outcome without copying raw product text. A background call first returns a Job id; the generic job controls later deliver a completion notice, expose the same final answer or failed status detail through `job_output`, and let `job_kill` request cancellation. Claude Code reasoning, tool activity, intermediate messages, stderr, workspace diffs, usage, product ids, tool inputs, and raw protocol payloads are not copied into the parent Session.

#### Token effect

Foreground input grows by the retained final answer or error. Background input also includes the start acknowledgement, completion notice, and any `job_output`, `job_kill`, or later status results; child tokens still do not enter the parent context. This provider adds no parent tool schema by itself.

#### KV Cache effect

Append-only: foreground adds one result after the reusable parent prefix, while background appends the Job acknowledgement, notice, and later control or collection results. Background scheduling can add a notice-driven turn, but none of these messages rewrites the earlier prefix.

## Known Limitations and Deferred Work

- **One fresh query and process per run** — there is no continuation, resume, pooling, progress stream, or product-session persistence.
- **Static instance selection** — Profile rows fix provider names and tool bindings; calls cannot choose a provider dynamically, and every exposed tool needs a unique `toolName`.
- **Host settings are intentionally authoritative** — project and user settings can change model, tools, and behavior; the provider does not provide a filtered or hermetic production mode.
- **Authentication and account state remain native** — the Bundle supplies the CLI but does not create an account, log in, or rewrite Claude settings; configuration and authentication failures surface with their lifecycle stage and the safe `unknown` fallback rather than a separate public classification.
- **The SDK platform payload is required at delegation time** — installs that omit optional dependencies, unsupported platforms, and missing or damaged payloads fail at the first query; there is no host-CLI fallback.
- **No human interaction path** — `AskUserQuestion` is disabled, permission prompts are denied, MCP elicitation is declined, and blocking dialogs fail closed instead of suspending.
- **Assistant payload is final text only** — a failed run may additionally expose the separate safe diagnostic; reasoning, intermediate messages, tool traffic, usage, stderr, and workspace diffs remain product-local, while generic Job ids, notices, and status come from the shared job runtime.
- **No optional shared capabilities** — output schemas, child personas, tool filtering, and harness depth enforcement are rejected by the shared service for this provider.
- **No wall-clock timeout or side-effect rollback** — the caller cancels long work, and files or external systems changed before cancellation are not restored.
