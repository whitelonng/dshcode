# `@deepseek-ai/dsh-client-ui-reference`

English | [中文](README.zh.md)

Unified Web `@file` and `@session` source. The browser starts the `fileReferences/list` and `sessionReferenceResolver/candidates` Remote calls together for an unquoted token, deterministically orders files before sessions with locale-registered folder/file/session labels, and renders the rows under non-selectable file and session section headings without a redundant raw `reference` source title. Either failed candidate domain degrades independently. An open `@"…` token searches files only.

File picks preserve the natural text defined by the shared `@path` grammar as their hidden serialized and clipboard form. A file closes completion as an atomic inline reference displayed with a file glyph, business-color filename, and no capsule. A directory remains plain editable path text with a folder glyph and keeps the menu active at its trailing slash so the user can descend another level. Paths containing whitespace use `@"path with spaces"`, and a quote the user opened explicitly remains quoted.

Session picks insert an atomic inline reference whose hidden `ref` and clipboard representation are the canonical `@[label](dsh-session:…)` mention returned by the Host. Its visible form is a chat-bubble glyph plus the business-color session title, without a capsule; serialization never reconstructs identity from that title. Ordinary send carries the canonical mention through `session.prompt`; the session-reference service validates it and captures model context at `agent/pre-step`.

The `/client` export is the plugin body (`apply`/`inject`) only; candidate encoding stays internal to the registration effect.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-file-reference-local` for path guidance and `@deepseek-ai/dsh-session-reference` for prepared session snapshots.

#### KV Cache effect

Candidate browsing has no model effect. A selected file or session changes only the new user-message suffix and any Host-prepared session-reference context that follows that message; earlier target history remains unchanged.

## Known Limitations and Deferred Work

- **Candidate failure is intentionally quiet** — one unavailable or failed Remote discovery call yields no rows for that domain. A session-reference preparation failure occurs after prompt acceptance and terminates that agent turn.
- **No browser-side file scan** — Web completion requires a mounted Host `ctx.fileReferences` provider; the browser cannot fall back to its own filesystem.
- **Session search remains metadata-only** — discovery filters session id, cwd, and the latest log-backed title through `ctx.sessionReferenceResolver`; message bodies and full transcripts are not searched.
