# Agent Note: the code-runtime-python fd-3 frame protocol

Status: implemented

English | [中文](2026-07-31-code-runtime-python-fd3-protocol.zh.md)

## Problem

The CPython code-runtime backend (`@deepseek-ai/dsh-code-runtime-python`, arriving across a PR stack) runs each model program in a fresh `python3 -I` subprocess and bridges binding calls and completion values over the child's fd 3. That channel needs a wire protocol both sides agree on, and the host cannot trust it: model code has full access to fd 3 and can forge any frame, so every inbound frame is hostile input the host must validate and rebuild before reading. The protocol also has to carry lossless JSON without the depth limit `JSON.stringify`/`json.dumps` impose, because the seam's `CodeJsonValue` is depth-unbounded.

This layer of the stack delivers only that protocol, so the large `PythonCodeRuntime` implementation and its real-subprocess integration suite land on a reviewed wire contract instead of arriving fused with it. The parent stack splits [#436](https://github.com/deepseek-harness/deepseek-harness/pull/436) — a 9000-line single PR — into reviewable layers; this is the protocol layer, based on the [seam extension](2026-07-31-code-runtime-portable-identifier-seam.md).

## Decision

`src/protocol.ts` is the host side of the wire vocabulary and its hostile-frame codec:

- **`validateChildFrame`** shape-validates and REBUILDS every inbound frame. The compile-time union means nothing on fd 3 — a forged frame can carry `null`, poisoned fields, or omit required ones — so each accepted frame is reconstructed field by field: forged extras never ride along, a non-finite call id can never be echoed into a reply, and junk returns `undefined` to be dropped rather than throwing in the host's message handler.
- **`encodeJsonPlain` / `checkDoneValue` / `hasUnsafeIntegerToken` / `hasNonLosslessNumber`** are the lossless-JSON codec and meters. They traverse iteratively (an explicit stack, not recursion) so a deep value below the byte budget crosses intact; `checkDoneValue` folds byte-metering and number-losslessness into one walk that rejects an over-budget payload before the INCREMENTAL work it would otherwise add — the enqueued children; strings and keys are metered by a non-allocating escaped-size scan (`jsonStringBytesUpTo`), so the escaped copy is never materialized. It does not re-bound the frame's own width: `done.value` is already `JSON.parse`'d when the check runs, so the payload's size is paid upstream and capped there by the host's fixed fd-3 receive buffer (a later stack layer), not here. Beyond-safe-range integral doubles serialize through `BigInt` digits so the exact integer crosses, not `String()`'s rounded form.
- **`logTruncationMarker`** produces the in-band marker text a log ledger emits when it exhausts its byte budget.

`py/protocol.py` mirrors the message shapes as `TypedDict`s and re-declares the two surfaces both sides EXECUTE against — `PROTOCOL_FD = 3` and `log_truncation_marker` — with byte-identical text.

The package skeleton (`package.json`, `tsconfig.json`, `tsdown.config.ts`, `src/index.ts`, `src/invariant.ts`, README triplet) ships here rather than in a later stack layer: `check-workspace-constraints` reads every `packages/<group>/<pkg>` package.json unconditionally, and the coverage and invariant-topology gates require the package to exist and build the moment its directory does. The later backend-core PR extends `src/index.ts` with `PythonCodeRuntime` and grows `package.json`'s dependencies; because it bases on this branch, those are edits, not conflicts.

## Wire contract

Frames are JSON-lines on fd 3, one object per line, leaving stdout/stderr free for the program's own output. Child → host: `boot-ack`, `call`, `log`, `done`. Host → child: `boot` (first frame), `run` (after `boot-ack`), and one `reply` per `call`. The `log` frame's `truncated` flag marks the frame that IS the child ledger's own truncation marker, so the host stops capturing at the same point the child did instead of inferring it from its own budget. `done.error.kind` is one of `exception`, `invalid-output`, `output-limit`; wall/CPU budgets, aborts, and substrate death are observed host-side, not carried as frames.

## Mirror alignment

Round-12 review of #436 found `py/protocol.py` stale against `src/protocol.ts` in three declarations — `LogMessage` lacked `truncated`, `DoneMessage.error` lacked `kind`, and `Namespace` lacked the optional `errorClass`. This PR aligns all three when lifting the file, so the stale mirror is not carried forward. To keep it aligned, `tests/protocol-mirror.e2e.ts` spawns a real `python3` and asserts, against `src/protocol.ts`: `PROTOCOL_FD` and `log_truncation_marker` (the two surfaces both sides execute), and each `TypedDict`'s required/optional wire field set — so a renamed or dropped field, or one side making a field optional the other requires (exactly the round-12 drift), fails the test. Field *types* are not compared across the language boundary; that residue stays with review.

## Alternatives considered

**Move the Python JSON codec (`_encode_json_plain` / `_decode_json_plain`) into `py/protocol.py` for cross-side symmetry with `protocol.ts`.** Rejected. The repository's "prefer symmetry for parallel values" rule points at genuinely parallel values; these are not. The host-side codec in `protocol.ts` validates HOSTILE input and is self-contained. The Python codec produces output on the TRUSTED side and is coupled to bootstrap-internal helpers (`_Emit`, `_dump_scalar`/`_dump_string`/`_dump_float`, `LogBuffer`'s cost accounting, `_check_done_value`, `_lossless_json_violation`); lifting only the two entry points would drag that web into `protocol.py` or create a `bootstrap.py` ↔ `protocol.py` import cycle. The real cross-side parallel is "host validates inbound (`protocol.ts`) ↔ child trusts host and emits (`bootstrap.py`)", and that symmetry is preserved: `protocol.py` stays the pure wire-vocabulary mirror it is on the TS side. The Python codec stays in `bootstrap.py`, delivered by the backend-core PR.

**Defer the package skeleton to the backend-core PR that "owns" package.json.** Rejected: the workspace-constraint, coverage, and invariant-topology gates fail the instant the `code-runtime-python` directory exists without a buildable package. A stacked split cannot create source files in a package that does not yet compile.

## Consequences

Bought: the fd-3 protocol and its hostile-input codec land as a self-contained, fully unit-covered layer, and the py/ts mirror drift the round-12 review found is fixed with an executing guard against its recurrence. The backend-core PR builds on a reviewed wire contract.

Cost: `src/index.ts` and `package.json` are introduced minimally here and edited (not created) by the backend-core PR. The mirror e2e compares field NAMES and required/optional-ness across the two sides but not field TYPES — comparing type declarations across TypeScript and Python has no mechanical equivalent, so that residue stays with review plus the backend's real-subprocess suite.
