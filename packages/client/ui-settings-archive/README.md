# dsh-client-ui-settings-archive

English | [中文](README.zh.md)

Archived conversations page in Web Settings. One section (`settings.section`, id `archive`) listing every registry-global archived session with its folded title and creation time. A search box filters the rows by title or session id; each row carries a selection checkbox with a select-all toggle, and the selection drives a bulk toolbar (恢复所选 runs immediately — restore is non-destructive; 删除所选 requires an explicit confirmation modal, then calls `workspace.deleteSession` per row — irreversible). Single-row actions:

- **恢复 (Restore)** — removes the session from the archive set through `workspace.restoreSession`; the session reappears in its original workspace position.
- **彻底删除 (Delete permanently)** — requires an explicit confirmation modal, then calls `workspace.deleteSession`; the host removes the session log from persistence and drops its workspace accounting and archive-set entries, and its `host/session-deleted` frame makes every connected client evict the session from its list mirror (without it, the stale summary would resurface under Ungrouped). A live session whose lifecycle the gateway owns is disposed first — the confirmation stands in for a separate close gesture. Irreversible.

The wire face (`list` / `restore` / `remove`) is injected from `apply` and talks to the shared `/api` fetch carrier (`workspace.listArchived` / `workspace.restoreSession` / `workspace.deleteSession`), with responses validated by `protocol.ts` at the client boundary; RPC failures reject as `ArchiveActionError` carrying the Host error code so the section maps known codes to actionable copy.

## Model Experience

### Browser settings section

#### What the model sees

Nothing from the `archive` section. The page performs no model requests, holds no conversation context, and registers no model-facing content; its list is folded from persisted session logs by the host `session-query` service through `workspace.listArchived`.

#### Token effect

Zero in the current process.

#### KV Cache effect

None in the current process; the section contributes nothing to any provider request.

## Known Limitations and Deferred Work

- Attachment bytes are content-addressed and shared across sessions; a permanent delete removes the session log but leaves orphaned attachment files until a future garbage-collection pass.
- The list refreshes on mount and after each mutation; a deletion performed in another window applies on the next mount of the page.
