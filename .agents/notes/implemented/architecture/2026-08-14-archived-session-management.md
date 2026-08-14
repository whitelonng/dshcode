# Agent Note: Archived-session management — restore and permanent delete

Status: implemented

English | [中文](2026-08-14-archived-session-management.zh.md)

> Scope: the full vertical slice that makes the archive set manageable — durable session deletion in persistence, workspace-accounting restore/remove, three workspace RPCs, client-runtime methods, and the settings page. Extends the [workspace archive set](2026-08-13-session-content-search-opt-in.md) mechanism and the [session persistence coordinator](2026-07-19-gui-layering-and-rpc-protocol.md) seam.

## Problem

Archiving a session was a one-way door: `workspace.archiveSession` hid the session from every grouping surface, but no UI listed the archived set, no RPC removed a session from it, and no durable delete existed anywhere in the stack — `SessionPersistence` was strictly append-only with no removal primitive. A user who archived a conversation could never see it again, let alone delete it permanently.

## Decision

### Durable session deletion

`SessionPersistence` gains `abstract delete(id)`, implemented by both first-party backends through the coordinator. The `PersistenceBackend` seam gains an optional `deleteStored(id, signal?)` hook (optional like `loadStoredFrom`/`locate`/`close`); the coordinator's `delete` drops the in-memory state, invalidates prepared reads, and refuses loudly when the backend lacks the hook. The JSONL backend resolves the log path by the existing id scan and removes the per-session directory; the SQLite backend deletes the event and session rows in one transaction. Deletion is visible to the next `list` observation, so the search index reconciles the removal. The shared persistence contract gains a delete round-trip test that every backend runs.

### Registry restore and accounting removal

`WorkspaceRegistry.restoreSession(id)` removes one id from the archive set (idempotent, keeps the accounting slot so the session reappears in its original position). `WorkspaceRegistry.removeSession(id)` detaches the id from every owning workspace (`WorkspaceEntity.detachSession`, idempotent) and drops it from the archive set; unknown ids are a no-op. Both write through the registry's operation chain, so the `host/archived-sessions-changed` frame fires automatically.

### Wire surface

Three additive workspace RPCs with zod schemas, fetch routes, and typed client methods:

- `workspace.restoreSession` — unarchive; answers the full updated set.
- `workspace.deleteSession` — permanent delete; refuses `not-archived` and `session-active` (a live session must be closed first). The log deletion is the irreversible step and happens first; workspace accounting is dropped only after it settles. Attachment bytes are content-addressed and shared across sessions, so they are intentionally left in place (see consequences).
- `workspace.listArchived` — the archive set with best-effort titles folded by `sessionQuery.readTitleSnapshots` and creation times from the persistence header list; items degrade gracefully when sessionQuery is absent.

`deleteSession` is deliberately NOT exposed to the agent tool catalog: it is destructive, product-surface only.

### Client runtime and settings page

The client `workspaces` service and manager gain `restoreSession`/`deleteSession`, installing the returned archive set through the existing `installArchived` projection (same echo discipline as `archiveSession`). A new client package `@deepseek-ai/dsh-client-ui-settings-archive` registers the `settings.section` page `archive` (nav order 30, after Models): one row per archived session (folded title or id, creation time) with 恢复 (restore) and 彻底删除 (delete) actions. Deletion requires an explicit confirmation modal; failures surface inline and keep the row. The wire face calls the shared `/api` carrier (`connection.rpc.call('/api', 'workspace.*')`) and validates responses in `protocol.ts`, mirroring the plugin-control tab pattern.

## Verification

The persistence contract suite runs the new delete round-trip against the memory, JSONL (plain and zstd), and SQLite backends. The workspace registry suite covers restore idempotence and accounting removal. The API proxy suite covers restore, successful delete of a non-live persisted session, and both refusal codes; the client-runtime suite covers the echo projection and failure propagation; the settings package covers the page flows (restore, confirmed delete, cancel, error, empty) and the section registration. The web replay suite re-records the settings-dialog snapshot, which now carries the 归档会话 nav row.

## Alternatives considered

**Garbage-collect attachment files during delete.** Rejected: attachments are content-addressed and shared, so deletion must either scan every remaining log for references (an O(all logs) pass per delete) or maintain a reference index. Both are separate subsystems; v1 deletes the conversation data and leaves orphaned bytes behind, documented as a known limitation with a future GC pass.

**Expose deleteSession to the agent tool catalog.** Rejected: permanent deletion is a user-only product action; a tool call would let a model destroy conversation history without the confirmation surface.

**Fold the page into an existing settings package.** Rejected: the page is a distinct feature domain (session lifecycle, not plugins or models); one feature = one plugin package, and the section slot keeps the shell free of page-specific copy.

## Consequences

- The archive set is now fully managed: restore returns a session to its workspace position, and permanent delete removes the log from persistence plus its accounting.
- Deleting while a session is live is refused with `session-active`; the client closes the conversation before the user can reach the page action.
- Attachment bytes of deleted sessions remain on disk until a future reference-counted GC; the confirmation modal states this explicitly.
- Backends that cannot delete (third-party) keep working; the coordinator refuses loudly only when `delete` is actually called.
- The settings dialog navigation gains one row (归档会话), which changes the assembled settings snapshot.
