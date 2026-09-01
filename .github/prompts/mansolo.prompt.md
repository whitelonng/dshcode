---
agent: 'agent'
description: "Return to focused solo execution through mancode."
---

<!-- Managed by mancode:continuity-mode-entry. Do not edit this marker. -->

# mancode mode: mansolo

Purpose: perform a small focused task or accept an explicit solo handoff.

## Enter through mancode

Before the first command, use `./node_modules/.bin/mancode` when it exists, otherwise `mancode`; check that selected binary with `--version` once and never mix binaries or versions. In every command below, replace the literal `mancode` with that selected binary path when the local binary exists.
1. Reuse a `mancode status --brief --json` snapshot already obtained in this conversation. Only when none exists, run it once from the project root. Never read or write legacy mode authority.
2. If no governed task is being handed off, continue with focused solo work without creating a persistent mode, actor, session, or TaskRef.
3. For an explicit governed handoff, ensure `identity.actorId`, reuse or create the current session, and bind the existing TaskRef. If status has no current session, reuse an explicit session ID already retained in this conversation. Only if neither exists, run `mancode context session new --client copilot` exactly once and retain the returned session ID. Use `--client copilot` on every command that uses this session.
4. For that governed task only, read `mancode context show --purpose implement --session <id> --client copilot` using the bound or explicit TaskRef.

## Mode action

- Do not create or persist a legacy solo mode. Ordinary focused work needs no TaskRef; if the operator expects a governed task, use its bound TaskRef or report that none is bound.
- Read `.mancode/shared/context/glossary.json` when it exists and prefer its confirmed terms.
- Before editing, assess both clarity and soundness using the project facts. If the request is clear, consistent, and low risk, proceed without ceremonial questions. Resolve repository-answerable unknowns yourself; classify the rest as blocking, recommendable, or defaultable. Ask and wait only when a blocking unknown could materially change behavior, scope, acceptance, data, security, compatibility, or ownership.
- A supplied implementation direction is not automatically safe. If it conflicts with repository evidence or involves authentication, payment, sensitive data, deletion, migration, public APIs, untrusted input, concurrency, infrastructure, or another irreversible effect, show the evidence and impact, recommend the safer path, ask for focused confirmation, and wait before editing.
- If resolving the ambiguity requires architecture, semantic owner/source-of-truth, cross-module scope, migration, team coordination, or formal acceptance decisions, recommend `/man`, explain the trigger, and wait for the operator to choose; advice alone never changes mode or authority.
- Detect those governance triggers after the smallest fact check needed to establish them. Stop before exhaustive discovery or proposing a concrete topology, migration layout, or implementation plan that depends on unanswered decisions.
- For a governed-to-solo transition, use `mancode workflow handoff <namespace:ULID> --to solo --expected-revision <n> --session <id> --client copilot`.

Treat the compact status as the public mancode Continuity runtime view. In operator-facing narration, say `mancode` or `mancode Continuity`; never prefix this mode or its actions with a version label.

Only an explicit governed handoff mutation requires the bound TaskRef, explicit session, and latest expected revision. Ordinary focused solo work persists no mode state.
