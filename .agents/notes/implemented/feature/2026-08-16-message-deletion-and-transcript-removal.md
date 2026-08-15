# Agent Note: Message deletion removes transcript turns from the append-only log

Status: implemented

English | [中文](2026-08-16-message-deletion-and-transcript-removal.zh.md)

## Problem

A conversation had no way to remove a message: the Like/Dislike sidecar ([archived sidecar note](../../archived/architecture/2026-08-10-message-feedback-sidecar.md)) recorded judgment but could not change the transcript, and a wrong or finished exchange stayed model-visible forever. Users asked to delete agent replies and their own messages after stopping a run, with the old content discarded from both the screen and the model-visible history.

## Decision

The session surface gains a third operation. `SurfaceOp` already folded `append` and `replace` (compaction); a new `{ op: 'delete', start, end }` removes the range without a replacement, carried only by a new `message/delete` session event whose `data` repeats the range and whose `sourceEventSeqs` cites every removed node (the existing provenance rule). The surface fold splices the nodes out and bumps `replaceGeneration`, so `deriveMessages()` — the single source of model-visible history — shrinks. The log stays append-only: the deletion is a replayable operation, not a rewrite. The session invariant rejects `message/delete` inside an open turn, so a deletion can never race model execution.

`sessions.deleteMessage` (apiproxy RPC) expands one target message seq into the surface range: a user message removes its whole turn (through the node before the next user message); an assistant message removes itself plus its own step's tool results, so no orphan tool results remain. A running agent fails with `agent-busy`; a non-message, unknown, or already-shadowed seq fails with `delete-unavailable`. Subagent conversations refuse locally with the same `agent-busy` fence.

The client transcript folds deletions in the conversation assembler: `foldTranscript` drops each raw `[start, end]` interval and the shadowed nodes of human edit-replace events, prunes the `turn/start..turn/end` brackets of turns that lose all content and the `step/start..step/end` brackets of emptied steps, and never renders the deletion markers themselves. The fold applies on every window rebuild (open, prepend, resync), so deletions survive pagination and reconnect. The UI adds a delete action to human-authored user bubbles and the assistant turn tail (disabled while any turn runs; a failed RPC surfaces a retry tooltip).

The Like/Dislike surface is removed in the same change: the `dsh-client-ui-message-feedback` and `dsh-message-feedback` packages are deleted, their Remote mount and bundle rows are gone, and their two implemented notes are archived.

## Alternatives considered

- **Physical log truncation at the turn boundary**: rejected — the log is the append-only source of truth for projections, persistence backends, and replay; live truncation would need per-backend surgery and would destroy audit history.
- **Reuse `replace` with an empty assistant message**: rejected — an empty assistant node is a max-tokens convention, not a deletion; it pollutes derivation and transcript folds with a fake node.
- **Model-only shadowing like compaction**: rejected — the human transcript must also drop the deleted content, so the client fold is a transcript-level operation while the model fold stays in the surface.

## Consequences

- Derived history, `session-reference` projections, and the chat transcript all exclude deleted ranges; the raw log still replays the original turn plus its deletion op.
- Token stats and titles continue to read original events — deleting a turn does not re-bill or rename history (accepted: stats describe what ran, not what the user kept).
- Deletion is a durable, model-visible transcript edit; the surface now has append, replace, and delete as its complete positional vocabulary.
