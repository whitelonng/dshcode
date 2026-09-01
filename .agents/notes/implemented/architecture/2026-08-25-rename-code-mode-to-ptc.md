# Agent Note: Rename code-mode to ptc — the transport is named PTC, user-facing copy says PTC mode

Status: implemented

English | [中文](2026-08-25-rename-code-mode-to-ptc.zh.md)

## Problem

The tool-registry presentation mode that exposes tools through a generated SDK and the `run_code` transport shipped under the name Code Mode, while the client preset that selects it already shipped as "PTC mode" (locale `presetPtcName: 'PTC mode'`, zh `PTC 模式`). One feature had two names: config values, plugin and event names, files, and documentation said `code`/`code-mode`, and the user-facing name said "PTC mode". A pre-release rename must update every reference together — no compatibility aliases.

## Decision

The feature is renamed to PTC (programmatic tool calls). Code identifiers use `ptc` — the transport is not a sibling of plan-mode, so the identifier does not carry `-mode`. User-facing prose keeps "PTC mode" (EN) / "PTC 模式" (zh), matching the shipped preset name.

Renamed in this PR:

- config value `tools.mode: 'code'` → `'ptc'` (`ToolPresentationMode` and the zod unions in `dsh-tools` and `dsh-agent-tool-presentation`)
- preset directory `presets/code/` → `presets/ptc/` (preset id `ptc`)
- source and test files `code-mode.ts` → `ptc.ts` and friends; root demo `demo:code-mode` → `demo:ptc` (`scripts/demo-ptc.mjs`)
- the dispatch waterfall `tools/code-dispatch-log` → `tools/ptc-dispatch-log` and types `CodeDispatch*` → `PtcDispatch*`
- prompt rule `tools:code-only` → `tools:ptc-only`
- prose "Code Mode" → "PTC mode" / "PTC 模式" in docs, READMEs, and the eight implemented Agent Notes whose topic names the feature (those files were renamed in place)

Deferred to the stacked persistence PR: the session-persistent vocabulary — the durable event types `tool/code-dispatch` / `tool/code-dispatch-start`, the logged plugin name `tools-code-mode`, and the sub-call id segment `:code:`. That PR is blocked until the `SESSION_FORMAT_VERSION` v0→v1 migration lands with it.

Kept unchanged: `run_code` and its `code` parameter (they name the program payload, not the mode), `CodeSdkLanguage`, `CodeRunFailedError`, the `dsh-code-runtime*` package family, the third-party `codex-code-mode-host` binary name, and every frozen archived note.

## Alternatives considered

- **`ptc-mode` identifiers** — rejected: PTC is a tool-presentation transport, not a mode in the plan-mode sense, and the identifier should not claim that kinship.
- **Surface-only rename** — rejected: the pre-release stance updates every reference together.
- **Renaming `run_code` too** — rejected: the tool name describes running a program, not the mode, and is model-facing API surface.
- **Renaming the durable event vocabulary in this PR** — rejected: renaming `tool/code-dispatch*` without a format bump would make pre-rename session logs unreadable; that rename belongs to the stacked persistence PR that lands together with the v0→v1 migration.

## Consequences

Configs with `mode: code` and preset ids `code` are unsupported on this build. The session-persistent vocabulary still says `tool/code-dispatch*`, `tools-code-mode`, and `:code:`, so existing session logs load unchanged and no `SESSION_FORMAT_VERSION` bump is needed yet. The stacked persistence PR renames that vocabulary and is blocked until the v0→v1 migration lands with it (the version mechanics are in the [session-log versioning note](2026-08-10-session-log-version-mechanism.md)). Keyless snapshot refreshes carry this PR's vocabulary; the persistence PR refreshes the dispatch-bearing fixtures. The shipped decision this note renames is [the PTC foundation note](../feature/2026-06-15-ptc.md).
