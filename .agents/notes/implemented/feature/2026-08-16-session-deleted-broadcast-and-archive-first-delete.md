# Agent Note: Session-Deleted Broadcast and Archive-First Sidebar Delete

Status: implemented

English | [中文](2026-08-16-session-deleted-broadcast-and-archive-first-delete.zh.md)

> Scope: the permanent-delete increment of the [archived session management](../architecture/2026-08-14-archived-session-management.md) seam — one new persistence event, one new host-stream frame, the client eviction that pairs with them, and the sidebar delete verb that routes through the archive set.

## Problem

Permanently deleting an archived session removed the log and the workspace accounting on the host but told no connected client. The client session-list mirror kept the stale summary; the archive-set frame un-hid it while the accounting removal left it unaccounted, so it resurfaced under Ungrouped within the same connection generation. Only a reconnect or reload re-baselined the list and removed the ghost.

The sidebar also exposed only an **Archive session** verb while the archive settings page described a delete flow. Users who wanted a conversation gone reached for workspace deletion instead — which never deletes sessions and merely orphans them into Ungrouped.

## Decision

### Persistence event at the delete commit point

`PersistenceCoordinator.delete` emits `session/deleted(sessionId)` after the backend `deleteStored` resolves — the single emission point both first-party backends delegate through. The event fires once per successful delete call, including the idempotent repeat on an absent artifact, so mirrors that learn only from this signal always converge. Declared in the dsh-session-persistence `Events` augmentation; the apiproxy harness stub mirrors the contract.

### Host frame and client eviction

`HostFrame` gains `host/session-deleted`; the host-stream builder subscribes to `session/deleted` and pushes the frame to every connection. `SessionManager` handles it through the same eviction routine as `host/session-removed` (`evictSession`), with two deliberate differences: a durable subagent row is evicted outright (its log is gone too, unlike a disposal), and the selection clears when it points at the deleted session.

### Sidebar delete is archive-first

The session row menu verb becomes **Delete session** (danger-styled, dialog-free): it commits `ctx.workspaces.archiveSession`, the archive-first soft delete — the gesture destroys nothing, the row hides everywhere the archive set hides it, and the Archived sessions settings page owns restore and permanent deletion. The settings empty-state copy now states this flow truthfully, and a `session-active` permanent-delete rejection maps to copy naming the remedy through a structured `ArchiveActionError` (Host error code preserved on the rejection).

## Verification

The memory persistence suite asserts the event emission (contract backends delegate to the coordinator). The apiproxy workspace suite asserts `deleteSession` streams `host/session-deleted` ahead of the archive-set frame. The connection fixture mirrors the real host (accounting drop, listing removal, three frames) and its spec asserts the sequence. Manager specs cover subagent eviction and selection clearing. The workspace-management e2e renames the row-menu scenario to the delete verb and adds a scenario that permanently deletes the archived seed from settings and asserts no Ungrouped resurrection — the ghost-regression guard.

## Alternatives considered

**Reusing `host/session-removed` for permanent deletion.** Rejected: the frame would conflate a live-session disposal (log retained, row may return on re-baseline) with an irreversible deletion; the shared eviction routine already deduplicates the behavior while the discriminant keeps the semantics explicit.

**Evicting locally from the settings page through the workspaces service.** Rejected: it converges only the acting tab; other open clients keep the ghost. The frame is the only cross-client channel.

## Consequences

- `HostFrame` has one more member; older clients ignore unknown frames (the documented default), keeping the ghost until their next re-baseline — no worse than before the change.
- The **Archive session** menu label no longer exists; the archive mechanism stays (settings page plus the unchanged `archiveSession` service face).
- The workspace-registration delete dialog is untouched: it still states that sessions survive under Ungrouped, now distinct from the session-level delete path.
