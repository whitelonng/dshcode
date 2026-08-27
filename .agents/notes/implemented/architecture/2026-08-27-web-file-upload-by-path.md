# Agent Note: Web GUI file upload sends host paths, not staged bytes

Status: implemented

English | [中文](2026-08-27-web-file-upload-by-path.zh.md)

## Problem

The composer only accepted images, and only as base64 inlined into the prompt (`createDraftImages` rejected every non-`png/jpeg/webp/gif` MIME with `UnsupportedImageMediaTypeError`). A user could not hand the agent an arbitrary local file without either staging a copy on disk or inflating the conversation with its bytes. The browser can never read a dragged file's real host path — `File` exposes only `name`, `size`, and content — so "send the path and let the agent read it" has no pure-browser route.

## Decision

Two complementary host capabilities, plus a composer split, all path-only:

- **`file-picker` / `file-picker-native`** (`ctx.filePicker`): a native-only capability seam whose single interaction `pickFiles({ multiple }, signal)` opens one OS chooser on the host display and returns the selected absolute paths. Native-only because a remote client has no display to open a chooser on; unlike `directory-picker` there is no browse twin. The gateway serves it as `host.pickFiles`, answering `file-picker-unavailable` under any non-native backend (fail loud, never fake a pick). macOS uses `osascript choose file`; Linux uses Zenity with a KDialog fallback; Windows fails loud until the koffi `IFileOpenDialog` file multi-select conversation is built.
- **Basename location** (`file-picker`'s `./locate`): `locateByName(root, name)` walks a tree for exact-basename matches and returns absolute paths — the zero-byte, zero-write answer for a drag, whose only input is a `name`. It accepts an optional `systemSearch` delegate for anything wider than the workspace walk (spotlight/`find`), which this increment does not wire; the gateway's `host.locateFiles` walks the session workspace only.
- **Composer split** (`InputBar`): a dropped/pasted file is classified by MIME — multi-modal images join the image rail unchanged; everything else resolves through `locateFiles` and inserts a `@path` mention (reusing `formatFileMention`) — never staged bytes. A new paperclip button drives `pickFiles` and inserts every selected path as a mention. A basename with zero or several matches is announced ("use the add-file button"), not silently dropped.

Why these shapes won:

- **Path-only beats staging.** Staging a copy into the workspace would satisfy "the agent reads it by path" but spends disk and risks clobbering the user's tree; a content-addressed object store (like images) sidesteps clobbering but yields no readable path at all. Returning the real path is the only option that is simultaneously zero-copy, zero-context, and agent-readable. Model-visible ⟺ logged holds trivially: the mention is ordinary prompt text.
- **Drag gets a name, not a path.** The `locateByName` exact-basename walk is precise and unambiguous at the workspace tier; the system-wide tier stays an injected delegate because its cost and coverage are the caller's policy, and this increment has no workspace-external consumer yet.
- **Native-only, discriminated anyway.** The `FilePickerCapabilities` map is declared merge-extensible from day one, mirroring `directory-picker`, so a future backend adds its shape without editing this package. The failure mode for an unsupported interaction is a typed `file-picker-unavailable` code, matching `directory-picker-unavailable`.
- **MIME decides image vs file in the composer.** The image rail's own admission keys on MIME too, so a suffix-only match would be refused there; routing on MIME alone keeps one rule and lets an unknown-type file fall through to path location (the agent picks the reading tool).

## Alternatives considered

- **Stage-then-mention and submit-time atomic staging** — both write bytes to disk (rejected; the operator asked for zero landing), and submit-time staging hides the path from the draft.
- **Bundle a system-wide search now** — `mdfind`/`find` per platform adds an OS-command surface and cost policy this increment has no consumer for; the `systemSearch` delegate keeps the seam ready without committing those choices.
- **Reuse `@file`'s `WorkspaceFileSearch`** — that index returns workspace-relative paths for autocomplete ranking, not absolute paths from a bare basename; a separate exact-basename walk is a different, smaller query.
- **Extend `directory-picker` with a `pickFiles` method** — rejected: the seam is named for directory selection and its browse/native contract is about levels and creation, not file selection; a sibling package keeps each contract's consumer set honest.

## Consequences

- Two new host packages (`file-picker`, `file-picker-native`), two gateway methods (`host.pickFiles`, `host.locateFiles`), and one error code (`file-picker-unavailable`) widen the web GUI's host surface; each mirrors the `directory-picker` seam and rides the same apiproxy/rpc/schema layers.
- The composer splits on the `image/*` MIME family, so a deployment's narrowed `imageLimits.mediaTypes` no longer changes the image-vs-file split (an `image/*` type keeps the image rail's authoritative "only PNG/JPG/WebP/GIF" refusal); an empty-MIME file always resolves by path.
- Windows file selection is not shipped: `pickNativeFiles` fails loud on win32 until the koffi `IFileOpenDialog` file multi-select conversation lands. Remote clients likewise have no display to open a chooser on.
- `locateByName` walks the workspace tree only; a wider `systemSearch` tier is an injected delegate left unwired until a workspace-external consumer needs it. Dragged basenames with zero or several matches announce "use the add-file button" rather than guessing.