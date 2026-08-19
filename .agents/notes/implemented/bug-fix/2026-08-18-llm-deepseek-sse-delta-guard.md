# Agent Note: The SSE translator stamps tool ids and names only from non-empty deltas

Status: implemented

English | [中文](2026-08-18-llm-deepseek-sse-delta-guard.zh.md)

## Problem

The DeepSeek SSE translator stamped a tool-call block from every delta value: `if (call.id !== undefined) block.callId = call.id`, and the same for `function.name`. Two gateway behaviors defeat that check (deepseek-ai/deepseek-harness#725; the hy3 and longcat-2.0 gateways exhibit both). Continuation deltas re-emit the field as an empty string, overwriting the established tool name with `""`, so every tool call then reports `unknown tool ""`. Other gateways emit `null`, which passes `!== undefined` and later coerces through string concatenation into destructive ids such as `"Globnull"`. Buggy builds also persisted the empty `callId` into session logs, and the load-time shape assertion in `packages/core/session` refused those files forever.

## Decision

`packages/llm/llm-deepseek/src/translate.ts` stamps `block.callId` and `block.name` only from deltas whose value is a non-empty string; the inline comment names both failure modes so the guard is not relaxed back to `!== undefined`. `assertMessageEventShape` in `packages/core/session/src/index.ts` no longer rejects an empty-string `callId` on `tool/result` events, so session files written by the buggy builds load again; the field must still be a string. Downstream behavior is unchanged for the corrupted records: the tool executor surfaces an unknown or empty name as `unknown tool`, and the session invariant still fails a `tool/result` whose callId has no matching `tool/call` in the step.

## Verification

Three `translate.spec.ts` regression tests pin empty-string and `null` continuation reseeds, and a `session.spec.ts` test loads a `tool/result` whose callId and tool-result block both carry `""`. The first two translate tests fail when the stamping guard is reverted. `translate.ts` keeps 100% line, branch, and function coverage.

## Alternatives considered

**Keep the strict shape assertion.** Rejected because it bricks every legacy session file written by the buggy builds: the persistence layer refuses to open the file forever instead of surfacing the one failed call.

**Fix only the translator and leave corrupted logs unreadable.** Rejected because the corruption already reached durable storage; load tolerance restores access without a migration or a format-version bump.

**Reject `null` earlier at the payload parser.** Rejected because `null` is already outside the declared wire type; the stamping guard is the single point where both failure modes converge, and a `typeof` check is stronger than `!== undefined`.

## Consequences

Session files with empty tool ids load and replay. Repair and projection treat those ids best-effort, and multiple empty ids collapse to one key in the repair map. The translator no longer overwrites an established id or name, and `null` never leaks into emitted events; a call whose gateway never sent a real id still logs an empty id and fails as `unknown tool` at execution. The relaxed assertion applies only to `tool/result` callIds; empty message ids on user/assistant messages still fail loudly.
