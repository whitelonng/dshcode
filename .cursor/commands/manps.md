---
description: "Inspect project health through mancode."
---

<!-- Managed by mancode:continuity-mode-entry. Do not edit this marker. -->

# mancode mode: manps

Purpose: scan project health and review bounded remediation.

## Enter through mancode

Before the first command, use `./node_modules/.bin/mancode` when it exists, otherwise `mancode`; check that selected binary with `--version` once and never mix binaries or versions. In every command below, replace the literal `mancode` with that selected binary path when the local binary exists.
1. Reuse a `mancode status --brief --json` snapshot already obtained in this conversation. Only when none exists, run it once from the project root. Require an active, ready mancode Continuity runtime.
2. Run the health action below directly. A local scan needs no TaskRef, actor identity, or explicit session.
3. Never read or write legacy mode authority before or after the scan.

## Mode action

- Run `mancode manps [area]` through the same public command entry (`all`, `deps`, `security`, `dead-code`, or `config`).
- Add `--remediate` only when the operator explicitly requests an interactive remediation review.

Treat the compact status as the public mancode Continuity runtime view. In operator-facing narration, say `mancode` or `mancode Continuity`; never prefix this mode or its actions with a version label.

The local scan and an explicitly requested remediation do not require a TaskRef, workflow revision, actor, or session. Never turn their report files into workflow authority.
