# Agent Note: SQLite physical chunk-row compression

Status: implemented

English | [中文](2026-08-18-sqlite-physical-chunk-row-compression.zh.md)

## Problem

The scalar [`session-persistence-sqlite`](../../../../packages/session/session-persistence-sqlite/README.md) layout stores one physical row per logical `SessionEvent`. Provider streams produce token-sized `assistant/chunk` events with repeated turn, step, block, type, and envelope fields, so transaction batching reduces commits without reducing row count or repeated JSON payload. The logical stream cannot be coalesced because chunk boundaries, sequence numbers, timestamps, replay, partial output, UI fidelity, and `sourceEventSeqs` remain observable.

A physical row that represents several events affects append contiguity, crash repair, suffix seeks, schema ownership, revisions, and stale writers. Durable decoding must also be fixed by the schema version; a configurable codec set could make one schema version unreadable under a different Cordis composition.

## Decision

`@deepseek-ai/dsh-session-persistence-sqlite` uses the packed schema-17 implementation. It is the only SQLite persistence package and provider; the predecessor scalar layout and the temporary versioned sibling are not retained. SQLite remains an opt-in switch, while shipped default compositions continue to use JSONL. Both backends implement the same `SessionPersistence` service through `PersistenceCoordinator`, so physical packing changes neither live event delivery nor the logical session API.

Schema 17 keeps ordinary ROWID tables and the composite `events(session_id, seq)` primary-key index. Scalar rows represent one logical event. Packed rows use the storage tags `text-chunks`, `reasoning-chunks`, and `tool-call-chunks`; the SQL `seq` and `time` columns hold the first logical member, and `data` holds the packed payload. Packed rows set `ignorable=0` as a physical discriminator and leave `source_event_seqs` and `surface_op` as `NULL`; scalar rows use `ignorable=1` only for logical ignorable events and `NULL` otherwise. A future ignorable logical event may therefore reuse a storage-tag name without being decoded as a packed row. The tags are storage vocabulary, not `SessionEventMap` members.

SQLite owns chunk encoding and validation inside the schema-17 package. Exact-field whitelisting means unknown fields, surface metadata, incompatible chunk identity, sequence gaps, and unsafe timestamps remain scalar rather than losing information. One packed row represents at most 1,024 events and 1 MiB of uncompressed UTF-8 `data`; the encoder partitions longer runs, and the decoder rejects rows outside those format limits.

The `data` column accepts `TEXT` or `BLOB`. Serialized values below 4 KiB remain text. At or above the threshold, the writer uses Zstandard level 3 and retains the frame only when it is smaller than the text; the reader decompresses the blob before strict UTF-8 decoding and JSON parsing. The fixed moderate level and threshold limit frame overhead and synchronous CPU work while capturing the repeated payloads that dominate retained bytes.

`source_event_seqs` remains the complete ordered list of earlier events cited by a surface node, including every streamed chunk behind an assembled assistant message. Schema 17 stores the first sequence as an unsigned varint and every subsequent signed difference as a ZigZag varint. This preserves arbitrary order and every sequence while exploiting the overwhelmingly consecutive lists produced by streaming. An empty list is an empty non-null blob, distinct from absent provenance.

### Transactional append packing

Each append acquires `BEGIN IMMEDIATE`, rechecks schema ownership, selects the bounded physical span that may cover the last stored sequence, and derives the next logical sequence from that decoded tail. A mismatch rejects a stale writer before mutation. The codec packs only the new durable batch. Its inserts, lazy session materialization, and one revision increment commit or roll back together.

Normal append never deletes or replaces an earlier event row. Fixed write-behind windows normally collect high-frequency deltas into useful runs, while sparse or explicitly flushed batches may remain scalar. This makes physical event writes proportional to newly durable batches and prevents a stable retained-row count from hiding repeated replacement of a growing JSON value.

### Reads and repair

Full reads decode each physical row as one all-or-nothing logical span and validate contiguous logical sequences. A reverse pass identifies the last valid `turn/end` without retaining a second decoded copy of the full physical scan; the forward pass decodes one row at a time into the required logical result. A malformed row or gap before that committed boundary is corruption; a malformed final physical row becomes the opaque repair marker at that row's base sequence. Recovery re-reads and validates that marker while holding the write lock, then deletes the whole physical row and any later rows before binding synthetic closers as scalar events. A stale repair cannot delete a newer writer's valid suffix.

`readFrom(id, fromSeq)` examines packed predecessors only within the maximum schema-17 row span, then reads from the earliest candidate that may contain `fromSeq`. The decoder filters reconstructed members below `fromSeq`, so a suffix may begin inside a packed row without parsing an unrelated earlier scalar row. Reading from that candidate also exposes an overlapping scalar row to contiguity validation instead of letting it hide the packed member. Packed data exceeding the uncompressed format byte limit rejects before JSON parsing.

### Schema ownership

A pristine database initializes at schema 17. Older physical schemas, foreign application identities, non-pristine unversioned databases, and incompatible schema objects reject; the pre-release package supplies no migration. Every connection disables trusted schemas and memory-mapped I/O before inspecting durable schema, then reads both settings back. After selecting and verifying the journal mode, the provider pins `synchronous=FULL` and verifies it so SQLite build defaults cannot weaken committed-append durability. Package code loads every statement and fixed pragma from closed-name `.sql` resources and binds runtime values as parameters.

### Physical-write regression

The repository regression guard writes 1,000 streamed deltas in 40-event durable batches. After every committed batch it compares every retained physical field, requires cumulative inserts to equal the final row count, and rejects changed or removed rows. It also checks the exact 31-row bound, the largest persisted record against the schema byte limit, and an idle interval with no WAL extent change. These checks prove bounded row structure and catch coarse write amplification; they do not establish device traffic because WAL frames can be overwritten in place and checkpoints also write the main database. Incident-class validation separately samples process physical bytes around active and idle periods and stresses synchronized multi-process access. Lock tests hold `BEGIN IMMEDIATE` in another process and verify bounded waiting and successful continuation.

## Alternatives considered

**Coalesce logical chunk events.** Rejected because it changes sequence references, replay, partial output, and live delivery. Physical records provide the storage reduction while restoring the authoritative log exactly.

**Run a periodic or post-commit compactor.** Rejected because it adds another writer lifecycle, races append and repair, changes revisions without a logical append, and adds disposal work.

**Merge each new batch into the prior packed tail.** Rejected because a stable database and row count can hide repeated delete-and-insert churn. Paced-stream measurement found higher process and WAL writes than the predecessor scalar layout even when the retained database was smaller. Batch-local packing gives up timing-independent row convergence to bound physical writes.

**Use `synchronous=NORMAL` with WAL.** Rejected because it permits a recent committed transaction to roll back after an operating-system crash or power loss. `append()` resolves only after its batch is durable, so the provider explicitly retains SQLite's `FULL` durability level across builds.

**Remove ROWID from `events`.** Rejected because the composite text/integer primary key then becomes the table B-tree key and is repeated through internal pages. On the 105-session comparison corpus, selective Zstandard with ordinary ROWID used 107.02 MB; the otherwise equivalent `WITHOUT ROWID` database used 126.75 MB.

**Set a larger SQLite page size.** Rejected because the retained-size change was negligible: 4 KiB pages used 107.08 MB and 32 KiB pages used 106.89 MB in the layout reconstruction. The larger page also increases WAL-frame and cache granularity. The provider therefore issues no `page_size` pragma.

**Compress every payload.** Rejected because small independent Zstandard frames add headers and synchronous CPU work while losing the cross-record dictionary opportunity of a whole-file stream. On the 105-session comparison corpus, a threshold sweep produced 75.01 MB at 4 KiB, versus 93.87 MB at 16 KiB and 60.92 MB at 1 KiB. The writer fixes level 3 rather than inheriting a library default, matching the moderate level used by [Codex cold-rollout compression](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/compression.rs) while retaining independent row access.

The final frozen comparison used 105 sessions, 2,507,860 logical events, 512-event durable batches, three independent builds per backend, and three read passes per build. SQLite used 75.01 MB, wrote in 8.58 s, read complete sessions at 3.95/21.58 ms p50/p95, read 50-event tails at 0.253/0.378 ms, and forked every session in 13.10 s. Zstandard JSONL used 30.65 MB and measured 28.21 s, 4.49/23.36 ms, 10.58/80.90 ms, and 14.48 s. The predecessor scalar SQLite layout used 709.57 MB and measured 10.64 s, 9.02/69.16 ms, 0.189/0.293 ms, and 19.30 s. The packed layout is 89.4% smaller than the predecessor, writes 19.4% faster, improves complete-read p50/p95 by 56.2%/68.8%, and reduces 2,507,860 physical event rows to 65,810. Scalar tail-50 and list micro-latency are lower, but the packed provider remains materially faster than JSONL on those paths and wins the dominant size, write, full-read, and fork costs. The 4 KiB threshold is the accepted balance rather than a strict dominance claim.

**Store packed payloads under the logical `assistant/chunk` type.** Rejected because payload heuristics make malformed rows ambiguous and couple physical decoding to future logical payload fields. Explicit tags fail loudly.

**Store `SessionHeader` fields in an extensible metadata blob.** Rejected for schema 17 because `agentPreset` is a typed core resume invariant shared by JSONL and SQLite, not provider extension metadata. Persisting validated core fields directly keeps both backends aligned; an untyped catch-all would add another compatibility mechanism without a current producer. Revisit this only with a core-owned, namespaced `SessionHeader` extension protocol implemented by every backend.

**Expose compression rules through configuration or a live registry.** Rejected because same-version databases must be readable independently of runtime topology. The codec is modular source code, but the durable rule set is fixed by schema version.

**Migrate older schemas in place.** Rejected under the pre-release policy. Changing strict column types requires rebuilding the event table, which turns the first append into an unbounded historical rewrite and temporarily duplicates storage. A new database keeps activation explicit and failure predictable.

**Store forked history as a parent reference.** Deferred because it changes independent-session persistence rather than physical row encoding. Codex uses referenced history and excludes referenced or pointer-bearing rollouts from cold compression, but this provider would first need explicit parent retention, deletion, repair, export, and cross-backend semantics. Copying remains the bounded local choice until the session service owns those rules.

**Keep the packed implementation as a versioned sibling.** Rejected because the pre-release repository has no compatibility promise for the scalar format, while two SQLite package names duplicate configuration, documentation, tests, and ownership. Historical benchmark artifacts retain the comparison without exposing a rollback provider.

## Consequences

The canonical SQLite provider preserves every logical persistence, replay, revision, crash-recovery, and model-facing behavior. High-frequency batches use fewer rows and fewer measured process disk-written bytes than the predecessor in paced-stream validation; idle samples add no measured writes. Packing ratio depends on durable batch boundaries, but previously committed rows are immutable outside explicit crash repair.

The cost is no migration from older pre-release SQLite schemas and timing-dependent physical row count. SQLite and Zstandard remain synchronous: each connection uses the configured `busyTimeoutMs` for a competing lock and blocks its JavaScript thread during that wait, while large row encoding and decoding also run on that thread. A cold open yields after an immediate `SQLITE_BUSY` journal-mode transition and starts no further attempt after an open-relative retry cutoff; an in-progress synchronous call may finish later. External SQL tooling must use the provider decoder rather than assuming every physical `events.type` is a logical event type or every payload column is text.

The [JSONL packed-row decision](2026-07-26-packed-chunk-rows-by-default.md), [bounded persistence batching](2026-08-08-bounded-session-persistence-write-batching.md), and original [session-persistence decision](2026-06-14-session-persistence.md) remain active: they respectively own the JSONL format, write scheduling, and backend-neutral service semantics.
