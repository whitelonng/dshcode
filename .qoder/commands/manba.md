---
name: manba
description: "Diagnose and verify a bug through mancode."
---

<!-- Managed by mancode:continuity-mode-entry. Do not edit this marker. -->

# mancode mode: manba

Purpose: reproduce, diagnose, fix, and verify a regression.

## Enter through mancode

Before the first command, use `./node_modules/.bin/mancode` when it exists, otherwise `mancode`; check that selected binary with `--version` once and never mix binaries or versions. In every command below, replace the literal `mancode` with that selected binary path when the local binary exists.
1. Reuse a `mancode status --brief --json` snapshot already obtained in this conversation. Only when none exists, run it once from the project root. Never read or write the legacy authority file.
2. If `identity.actorId` is absent, ask for a display name and run `mancode team identity create --name "<display name>"`.
3. Reuse `session.sessionId` when present. If status has no current session, reuse an explicit session ID already retained in this conversation. Only if neither exists, run `mancode context session new --client qoder` exactly once and retain the returned session ID. Use `--client qoder` on every command that uses this session.
4. Reuse the current TaskRef. To bind a supplied existing task, run `mancode context resume <namespace:ULID> --session <id> --client qoder`.
5. For an existing task, read only the needed Context Pack with `mancode context show --purpose implement --session <id> --client qoder`; include `--task <namespace:ULID>` when it is not yet bound. For a new task, create it through the mode action first, then read the returned TaskRef's Context Pack.

## Mode action

- For a new diagnostic task, run `mancode workflow create manba "<task>" --session <id> --client qoder`.
- Before changing code, establish the expected behavior from reproducible evidence, tests, documentation, history, or the current semantic owner. If the bug goal is clear but the correct behavior cannot be established, ask one focused question and wait instead of inventing product behavior.
- If the requested fix conflicts with repository evidence or crosses a hard-risk boundary, show the conflict and obtain a focused confirmation or route the decision through `/man`; do not treat an explicit but unsound fix instruction as sufficient evidence.
- When this is a child investigation, add `--parent <namespace:ULID>`; report and merge the typed outcome through the mancode child commands.
- Change lifecycle only with `mancode workflow update <namespace:ULID> --status <status> --expected-revision <n> --session <id> --client qoder` and finish with `workflow complete` plus the typed `--outcome`.

Treat the compact status as the public mancode Continuity runtime view. In operator-facing narration, say `mancode` or `mancode Continuity`; never prefix this mode or its actions with a version label.

For every mutation, use the TaskRef, explicit session, matching client, and latest expected revision reported by mancode. Do not emulate the legacy `--step` protocol or persist mode state in an adapter file.
