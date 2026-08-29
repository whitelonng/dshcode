# @deepseek-ai/dsh-code-runtime-python

English | [中文](README.zh.md)

CPython-subprocess implementation of the [`@deepseek-ai/dsh-code-runtime`](../code-runtime/README.md) seam. Companion to [`@deepseek-ai/dsh-code-runtime-worker-thread`](../code-runtime-worker-thread/README.md); trades the Node worker thread for a fresh `python3` subprocess so model code is Python instead of TypeScript.

The package owns the wire protocol for that seam: the host-side frame codec and the Python-side mirror of the same message vocabulary.

## Wire protocol

The host and the CPython subprocess exchange a versionless, JSON-lines protocol on the child's fd 3 — one JSON object per line, leaving stdout/stderr free for the program's own output. `src/protocol.ts` is the host side; `py/protocol.py` mirrors its message shapes and the shared truncation-marker text on the Python side.

- **fd 3, not stdout** — Node pins the channel positionally with `stdio: ['pipe','pipe','pipe','pipe']`; the Python bootstrap reads the same `PROTOCOL_FD` constant. JSON-lines framing.
- **Host treats every inbound frame as hostile** — model code has full access to fd 3 and can post anything through it, so `validateChildFrame` shape-validates and REBUILDS each frame before the host reads it: forged extra fields never ride along, a non-number call id can never be echoed into a reply, and junk drops to `undefined` rather than throwing in the host's message handler. The Python side trusts host replies (the host is not model-controlled).
- **Lossless-JSON crossing** — completion values and binding arguments cross as exact JSON. `encodeJsonPlain` serializes a `JSON.parse`-produced value without recursion, so a deep value below the byte budget crosses intact instead of dying on `JSON.stringify`'s stack limit; `checkDoneValue` meters a forged completion value's byte length AND number losslessness in one traversal that rejects an over-budget payload before the incremental work it would add (the enqueued children; strings and keys are metered by a non-allocating escaped-size scan, so the escaped copy is never materialized) — the frame's own width is already parsed and capped upstream by the host's fd-3 receive buffer, not re-bounded here; `hasUnsafeIntegerToken` reads the raw frame text to catch an integer token that `JSON.parse` would silently round; `hasNonLosslessNumber` rejects a non-finite or negative-zero number in unbounded `call.args`. Beyond-safe-range integral doubles serialize through `BigInt` digits so the exact integer crosses, not the rounded `String()` form.
- **Shared truncation marker** — `logTruncationMarker(maxBytes)` produces byte-identical text on both sides, so a truncated log run reads the same however the cap was hit. The `log` frame's `truncated` flag distinguishes the child ledger's own marker from program output.

## Model Experience

Indirectly, through Code Mode in [`dsh-tools`](../../core/tools/README.md), which renders this backend's exact completion value when it fits (or an explicit `invalid-output` / `output-limit` failure), plus the exact `[dsh-code-runtime-python] log capture truncated at <maxLogBytes> bytes` log marker, into a retained `run_code` result.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **The cross-language guard covers the runtime-executed surfaces and the frame field shapes** — `tests/protocol-mirror.e2e.ts` spawns a real `python3` and asserts, against `src/protocol.ts`, both `PROTOCOL_FD` / the log truncation marker text AND each `TypedDict`'s required/optional wire field set in `py/protocol.py`. What it does not compare is the field *types* (e.g. that `cpuSeconds` is an `int` on both sides): comparing type declarations across TypeScript and Python has no mechanical equivalent here, so a type-level drift is still caught by review plus the backend's real-subprocess suite rather than this package's tests.
- **`src/index.ts` exports the protocol vocabulary only** — the package carries no subprocess execution path and no Python-side JSON codec, so nothing here spawns `python3` outside the mirror test.
