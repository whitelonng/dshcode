---
description: "Coordinate shared governed work through mancode."
---

<!-- Managed by mancode:continuity-mode-entry. Do not edit this marker. -->

# mancode mode: manteam

Purpose: plan and execute work with explicit team ownership and handoff.

## Enter through mancode

Before the first command, use `./node_modules/.bin/mancode` when it exists, otherwise `mancode`; check that selected binary with `--version` once and never mix binaries or versions. In every command below, replace the literal `mancode` with that selected binary path when the local binary exists.
1. Reuse a `mancode status --brief --json` snapshot already obtained in this conversation. Only when none exists, run it once from the project root. Never read or write the legacy authority file.
2. If `identity.actorId` is absent, ask for a display name and run `mancode team identity create --name "<display name>"`.
3. Reuse `session.sessionId` when present. If status has no current session, reuse an explicit session ID already retained in this conversation. Only if neither exists, run `mancode context session new --client cursor` exactly once and retain the returned session ID. Use `--client cursor` on every command that uses this session.
4. Reuse the current TaskRef. To bind a supplied existing task, run `mancode context resume <namespace:ULID> --session <id> --client cursor`.
5. For an existing task, read only the needed Context Pack with `mancode context show --purpose plan --session <id> --client cursor`; include `--task <namespace:ULID>` when it is not yet bound. For a new task, create it through the mode action first, then read the returned TaskRef's Context Pack.

## Mode action

- Confirm team membership with `mancode team status`; join invited participants before assigning shared work.
- Read `.mancode/shared/context/glossary.json` when it exists and prefer its confirmed terms in shared requirements, plans, and handoffs.
- For a new shared task, run `mancode workflow create manteam "<task>" --visibility shared --coordination team --confirm-shared --session <id> --client cursor`.
- Run the same bounded read-only discovery as `man`, with at most F-1 through F-3 typed as premise, scope, technical, risk, or acceptance and marked as `repository_fact` or `domain_hypothesis`; an unverified domain hypothesis becomes a focused question, never a fact. Discovery produces evidence and recommendations, never execution authority.
- Give every F-ID one type-directed disposition: Accepted scope or behavior findings enter `confirmedScope` and the matching `acceptanceCriteria`; accepted technical choices enter `technicalDecisions`; Only explicitly excluded behavior enters `excludedScope`; low-impact reversible details may enter `defaults`; an unaccepted proposal remains unauthorized without being copied into every field.
- Apply the same decision-readiness gate as `man` before finalizing requirements: validate both clarity and soundness against project facts and team authority. If the goal, scope, acceptance, owner/source of truth, and constraints are clear and consistent, continue without ceremonial questions; if a decision-changing ambiguity, ownership conflict, or hard-risk direction remains, give evidence and a recommendation, ask focused questions, and wait before writing confirmed requirements.
- Persist unresolved team clarification through the same `workflow requirements <namespace:ULID> draft --file <requirements.json>` command as `man`; do not leave ownership questions or partial answers only in chat history.
- Bind the confirmed team plan to the user-visible `implementationScope` through plan revise `--scope-file`; claims, edits, and review must stay inside include and outside exclude. Before editing, state material assumptions and verifiable success criteria, reuse existing code and dependencies, and make the smallest direct plan-traceable change; newly proposed behavior outside confirmed requirements requires read-only `NEEDS_REALIGNMENT` and operator-approved reframe.
- If the operator explicitly approves a file-boundary-only adjustment that leaves confirmed behavior and acceptance unchanged, use `mancode workflow scope change <shared:ULID> --expected-revision <n> --file <scope.json> --session <id> --client cursor`. It versions the plan authority, stales prior review/verification, and reissues compatible claims. Behavior or acceptance changes still require reframe.
- Use claims, checkpoints, sync, and handoffs through `mancode team`; never infer ownership from an adapter prompt.
- With git-ref transport, workflow creation plus requirements, plan, review, and verification mutations use an explicit deferred publication boundary: run the workflow command without `--sync`, commit the resulting `.mancode/shared` authority changes together with the matching code head, then run `mancode team sync push <shared:ULID> --expected-task-revision <n>`. Never report cross-clone synchronization before the push returns a receipt. Use `--sync` only for a command whose contract performs an atomic git-ref mutation. If that atomic mutation leaves tracked `.mancode/shared` projection changes for a resumable in-progress or blocked task, commit them, then run the same `team sync push` with the unchanged task revision to rebind the remote code head before another clone resumes the task.

Treat the compact status as the public mancode Continuity runtime view. In operator-facing narration, say `mancode` or `mancode Continuity`; never prefix this mode or its actions with a version label.

For every mutation, use the TaskRef, explicit session, matching client, and latest expected revision reported by mancode. Do not emulate the legacy `--step` protocol or persist mode state in an adapter file.
