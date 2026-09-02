---
description: "The archived-conversations page in Web Settings: lists every registry-global archived session, lets the user search, bulk-restore, or permanently delete rows, and drive the semantics through the workspace archive-seam callbacks."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-archive

English | [中文](README.zh.md)

## Summary

The archived-conversations page in Web Settings. One section (`settings.section`, id `archive`) lists every registry-global archived session with its folded title and creation time; a search box filters rows by title or session id, and a selection checkbox with a bulk toolbar drives restore (non-destructive) and permanent delete (irreversible) across the selection. Single-row actions mirror those same two operations. The wire face (`list` / `restore` / `remove`) is injected from `apply` and talks to the shared `/api` fetch carrier, with responses validated at the client boundary and RPC failures rejecting as `ArchiveActionError` mapping known host error codes to actionable copy.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose the package into the client assembly and let it register the `settings.section` entry; the archive page appears under Web Settings.

### When to choose it

Choose this package when a settings surface must give the human control over which sessions stay archived — listing, searching, restoring, or permanently deleting them. Skip it for an in-session management surface that already owns its own archived rows, where injecting the archive callbacks directly is simpler.

### Minimal configuration

No mount: the package registers nothing into a composition. Its wire face is injected from `apply` and reads the shared `/api` fetch carrier, so no configuration row is required.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The section renders rows from the workspace archive-set snapshot. Restore removes the session from the archive set through `workspace.restoreSession`, so the session reappears in its original workspace position; permanent delete calls `workspace.deleteSession`, which removes the session log from persistence and drops its workspace accounting and archive-set entries — its `host/session-deleted` frame makes every connected client evict the session from its list mirror. A live session whose lifecycle the gateway owns is disposed first. The wire face (`list` / `restore` / `remove`) is injected from `apply`, carries the workspace archive-seam callbacks, validates each response in `protocol.ts` at the client boundary, and rejects as `ArchiveActionError` carrying the Host error code so the section maps known codes to actionable copy.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web client architecture](../../../docs/subsystems/web-client.md)
- [Client workspace API](../../../packages/api/workspace-controller/README.md)
- [Settings seam](../../../packages/settings/settings/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Browser settings section

#### What the model sees

Nothing from the `archive` section. The page performs no model requests, holds no conversation context, and registers no model-facing content; its list is folded from persisted session logs by the host `session-query` service through `workspace.listArchived`.

#### Token effect

Zero in the current process.

#### KV Cache effect

None in the current process; the section contributes nothing to any provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Attachment bytes are content-addressed and shared across sessions; a permanent delete removes the session log but leaves orphaned attachment files until a future garbage-collection pass.
- The list refreshes on mount and after each mutation; a deletion performed in another window applies on the next mount of the page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
