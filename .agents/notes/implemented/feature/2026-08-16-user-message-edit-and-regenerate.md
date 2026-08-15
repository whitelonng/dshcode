# Agent Note: User message edit regenerates the turn as a surface replace

Status: implemented

English | [中文](2026-08-16-user-message-edit-and-regenerate.zh.md)

## Problem

After stopping a run there was no way to revise the just-sent prompt: deleting ([message deletion](../feature/2026-08-16-message-deletion-and-transcript-removal.md)) removed content, but fixing a typo or rephrasing the question meant retyping it as a new message, which kept the old exchange in history.

## Decision

Editing reuses the surface `replace` operation the deletion feature already folds. The replacement is the new turn's own message, not a separate event: `Agent.followup` gains an optional `FollowupReplace { start, end, sourceEventSeqs }`, and the loop appends the first claimed message of that turn with `surfaceOp: { op: 'replace', … }` instead of `'append'`. The pending rewrite is consumed by that first claim and cleared when the turn ends, so a rejected wake cannot leak it into a later turn. The model therefore sees the edited prompt in place of the old turn, and the regeneration answers it directly — no duplicate user message, no loop-visible second event.

`sessions.editMessage` (apiproxy RPC) admits only the surface's last user message (source `user`), refuses `edit-unavailable` for anything else and `agent-busy` while a turn runs, expands the range to the whole old turn (through the node before the next user message), and drives `agent.followup(message, replace)` after the same durable-content and image-admission path as `session.prompt`.

The client transcript fold (`foldTranscript`) now derives hidden ranges from the window itself: `message/delete` intervals plus the `sourceEventSeqs` of human `user/message` replace events. Compaction checkpoints (plugin-source replaces) stay unfolded — the transcript keeps compacted history it already showed. The `input-message` node definition additionally matches human edit-replace events so the edited bubble renders; the UI adds an Edit action to the last human user message (idle turns only), opening an inline editor whose submit calls `editMessage` and whose failure keeps the draft open with a retry hint.

## Alternatives considered

- **A separate `user/edit` event plus a message-free turn wake**: rejected — the driver has no message-free wake, and a separate event would put the edited text on the surface twice (edit event + claimed follow-up message).
- **Refilling the composer InputBar**: rejected for this pass — the input machine owns chip/decorations state; the inline editor delivers the same stop → revise → regenerate flow without a machine-wide edit mode.
- **Physical truncation**: rejected for the same append-only reasons as deletion.

## Consequences

- Editing is a surface replace of the whole previous turn: derived history contains exactly one edited prompt followed by its fresh answer.
- The raw log keeps the original turn and the replacement event; replay reconstructs both model-visible and transcript states.
- Only the conversation's last user message is editable; earlier messages require deleting or forking, which the deletion feature already covers.
