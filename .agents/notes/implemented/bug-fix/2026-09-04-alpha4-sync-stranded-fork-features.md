# Agent Note: Alpha.4 sync stranded fork features on rewritten planes

Status: implemented

English | [中文](2026-09-04-alpha4-sync-stranded-fork-features.zh.md)

## Problem

The dsh-v0.1.2-alpha.4 sync rebuilt the planes the fork's own features ride on: apiproxy became the Typert session and workspace controllers behind the Gateway, the conversation assembler was rewritten, the WebWorker deployment and its packer evolved, and the Plugins settings page split into two tabs. The fork's message delete/edit, archived-session management, and plugin-management features survived only as callers of surfaces the merge removed, so the branch shipped dead UI — deletes and edits that silently did nothing or threw in the page, a stranded Archived-sessions dialog, an empty plugin tool catalog — plus a packed preview that could not boot, all behind a green static lane.

## Decision

Restore each feature on the merged planes under the contracts the merged code already implies:

- Message delete/edit are session-controller Remote methods carrying the pre-merge surface-range expansion (a user message deletes its whole turn, an assistant message deletes itself plus its step's tool results, a turn end anchors the whole interrupted turn; running turns answer `agent-busy`; subagent sessions refuse locally). The assembler regains its rebuild-on-transcript-edit branch so live connections fold deletions and edit-replaces, and `deleteAt`/`editAt` thread from the session face to the keyed chat node renderers.
- The archive trio (list, restore, permanent delete) are `workspace/*` Gateway remotes behind the shared workspaces client service. Permanent deletion refuses still-live sessions with `workspace/session-active`, and `session/deleted` forwards as `api-session/deleted` so every open client evicts the deleted row.
- The WebWorker plane carries the restored plugin composition at upstream parity: static node-module registrations for `node:stream/web`, `node:stream/promises`, `assert`, and `node:string_decoder` with real module faces, a Node-shaped default for `node:events`, `import.meta.dirname` on the loader's lowered meta face, the worker host providing `profileUserPatchPath` from the image manifest's profile name, and `apps/web` dependency metadata matching upstream.
- The web test scaffold and specs track the shipped product: the scaffold provides the launcher's `profileUserPatchPath`, the Plugins spec drives both shipped tabs, the en dialog records against the real English surface, and the locale-fallback expectation follows the fork's documented Chinese-first fallback.

## Alternatives considered

**Keep the fork's apiproxy alongside the Gateway.** Rejected: one API plane is the sync's purpose; a second transport would split session truth and reintroduce the dot-endpoint ambiguity the Gateway's two-segment `claimsEndpoint` contract removed.

**Re-create the pre-merge dispose-on-delete behavior for live sessions.** Rejected: permanently deleting a live session races its agent. The merged surface has an explicit closed-turn model and the refusal copy already anticipated it, so permanent deletion requires an archived session and the client says so.

**Widen the worker image to carry whatever the closure requests.** Rejected: the pack sweep exists to fail loudly on undeclared modules. Adding real builtin faces for the requested specifiers and correcting the dependency metadata keeps that failure mode loud instead of shipping a larger image that hides the next undeclared import.

## Consequences

The three features work end-to-end again on the merged planes, with narrower contracts where the merged code demanded them: live sessions refuse permanent deletion, and a completed deletion evicts the row from every connected client instead of resurrecting it. Specs drive the shipped product rather than pre-merge surfaces, so the next sync's adaptation surface is a spec delta rather than silent feature loss. The worker builtin faces are fork-owned platform code — a composition that requests a new node builtin must add a real face to the registry, and the pack sweep remains the guard that makes a miss fail the pack.
