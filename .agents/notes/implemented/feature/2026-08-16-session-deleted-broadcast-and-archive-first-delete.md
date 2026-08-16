# Agent Note: Session-Deleted Broadcast and Permanent Deletion of Live Sessions

Status: implemented

English | [中文](2026-08-16-session-deleted-broadcast-and-archive-first-delete.zh.md)

> Scope: the permanent-delete increment of the [archived session management](../architecture/2026-08-14-archived-session-management.md) seam — one new persistence event, one new host-stream frame, the client eviction that pairs with them, gateway-owned live-session disposal on delete, and the two missing error-schema branches that made every refusal unparsable.

## Problem

Permanently deleting an archived session removed the log and the workspace accounting on the host but told no connected client. The client session-list mirror kept the stale summary; the archive-set frame un-hid it while the accounting removal left it unaccounted, so it resurfaced under Ungrouped within the same connection generation. Only a reconnect or reload re-baselined the list and removed the ghost.

Two further defects surfaced in the same flow. The `rpcErrorSchema` discriminated union never gained the `not-archived`/`session-active` branches the archive feature added to `RpcErrorDetailsMap`, so any refusal response failed client-side validation and rendered as a raw zod `invalid_union` dump. And the `session-active` refusal itself was a dead end: the gateway drops every owned `AgentHandle` at creation, so no session ever leaves the store, and "close the conversation first" was advice with no affordance behind it.

## Decision

### Persistence event at the delete commit point

`PersistenceCoordinator.delete` emits `session/deleted(sessionId)` after the backend `deleteStored` resolves — the single emission point both first-party backends delegate through. The event fires once per successful delete call, including the idempotent repeat on an absent artifact, so mirrors that learn only from this signal always converge. Declared in the dsh-session-persistence `Events` augmentation; the apiproxy harness stub mirrors the contract.

### Host frame and client eviction

`HostFrame` gains `host/session-deleted`; the host-stream builder subscribes to `session/deleted` and pushes the frame to every connection. `SessionManager` handles it through the same eviction routine as `host/session-removed` (`evictSession`), with two deliberate differences: a durable subagent row is evicted outright (its log is gone too, unlike a disposal), and the selection clears when it points at the deleted session.

### Live sessions are disposed on permanent delete

The gateway records the owned `AgentHandle` of every session it creates or resumes (`sessionDisposals`). `workspace.deleteSession` disposes a live session through that handle — stop the loop, unregister the agent, remove the session — before deleting the log, because the settings page's explicit confirmation already stands in for a separate close gesture and the deletion frame evicts the row in every tab. Sessions created outside the gateway (subagents) have no disposal entry and keep the `session-active` refusal.

### Error schema completeness and the sidebar verb

`rpcErrorSchema` gains the `not-archived` and `session-active` branches so every refusal parses and the settings page maps `session-active` to actionable copy through the structured `ArchiveActionError`. The sidebar session-row verb stays **Archive session** (dialog-free, non-destructive); the Archived sessions settings page owns restore and permanent deletion, and its empty-state copy now states that flow truthfully.

## Verification

The memory persistence suite asserts the event emission. The apiproxy schema spec parses both new error branches; the workspace suite asserts `deleteSession` streams `host/session-deleted` ahead of the archive-set frame and that an owned live session is disposed (agent unregistered) instead of refused. The connection fixture mirrors the real host (accounting drop, listing removal, three frames) and its spec asserts the sequence. Manager specs cover subagent eviction and selection clearing. The workspace-management e2e archives from the row menu, permanently deletes a cold session from settings, and asserts no Ungrouped resurrection — the ghost-regression guard.

## Alternatives considered

**Reusing `host/session-removed` for permanent deletion.** Rejected: the frame would conflate a live-session disposal (log retained, row may return on re-baseline) with an irreversible deletion; the shared eviction routine already deduplicates the behavior while the discriminant keeps the semantics explicit.

**Evicting locally from the settings page through the workspaces service.** Rejected: it converges only the acting tab; other open clients keep the ghost. The frame is the only cross-client channel.

**Refusing live-session deletion with `session-active` only.** Rejected after the first release round: with no close affordance anywhere in the product, the refusal was an unreachable remedy, so owned live sessions are disposed instead and the code survives only for gateway-unowned sessions.

## Consequences

- `HostFrame` has one more member; older clients ignore unknown frames (the documented default), keeping the ghost until their next re-baseline — no worse than before the change.
- Deleting a session that is still open in another tab works: the tab's row disappears on the deletion frame instead of erroring.
- The sidebar **Archive session** label is unchanged; the settings nav gains the archive glyph instead of the default gear.
- The workspace-registration delete dialog is untouched: it still states that sessions survive under Ungrouped, now distinct from the session-level delete path.
