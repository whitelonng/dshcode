# Agent Note: Quarantine unreadable historical attachments

Status: proposed

English | [中文](2026-08-20-attachment-read-quarantine.zh.md)

## Problem

An admitted `ImageAttachmentRef` remains in durable history and therefore participates in every later request until compaction replaces it. `AttachmentStore.readImage()` fails with `ATTACHMENT_NOT_FOUND`, `ATTACHMENT_CORRUPT`, or `ATTACHMENT_READ_FAILED` when the referenced object disappears, fails integrity verification, or cannot be read. The unchanged history then makes every later model request fail on the same object, leaving the session unable to continue even though the remaining messages are usable. This is the unavailable-object case left fail-loud by [reconstructable requests](../../implemented/architecture/2026-07-05-reconstructable-requests.md).

## Proposal

A session-backed image-request projection records unreadable references before provider dispatch. `ATTACHMENT_NOT_FOUND` and `ATTACHMENT_CORRUPT` immediately append `attachment/quarantine`; `ATTACHMENT_READ_FAILED` receives one cancellation-aware read retry and appends the same event with a retryable reason if the retry fails. Cancellation and unclassified failures do not quarantine data.

The quarantine event identifies the attachment and failure class. Projection replaces each quarantined image with deterministic text containing its display name when present, attachment-id prefix, and failure class. Later requests derive the same replacement from the log and skip `readImage()` for that reference, while the original image block remains in append-only history. A request that discovers and records a quarantine reprojects before calling the provider, so the failed read does not become a terminal model-request attempt.

Explicit recovery calls `readImage()` and appends `attachment/recovered` only after digest and metadata verification succeeds. Projection then restores the original image reference. Missing or corrupt bytes are never overwritten automatically, and clearing quarantine without verification is invalid.

The shared request-projection consumer owns this policy. Attachment storage continues to report exact read failures, and provider adapters do not invent independent placeholders or recovery state.

## Alternatives considered

- **Keep failing every request.** This preserves strict error reporting but makes an otherwise usable durable session permanently unavailable after one storage fault.
- **Delete or rewrite the historical image block.** That loses evidence, violates append-only history, and prevents a repaired content-addressed object from restoring the original request.
- **Catch the error independently in each adapter.** An unlogged placeholder would make replay depend on which adapter and storage state happened to be present, while duplicated policies would drift.
- **Replace missing or corrupt bytes automatically.** The reference names verified immutable content; substituting different bytes under that identity would defeat integrity checking.

## Acceptance criteria

- A missing or corrupt historical image produces one durable quarantine transition and a stable placeholder; later model requests do not read that object or fail because of it.
- A general read failure is retried once without ignoring cancellation, then follows the retryable quarantine path.
- Restart and fork reconstruct the same quarantined request from the session log.
- Recovery restores image projection only after the original reference passes complete read verification.
- Package tests cover error classification, idempotent quarantine, cancellation, retry, recovery, and nested tool-result images; a keyless runnable snapshot pins the model-visible placeholder and durable events.

## Risks

Quarantine and recovery each change the provider prefix once. The implementation must identify the exact failing reference before recording state and must coordinate concurrent requests so duplicate failures produce one effective transition. Auxiliary calls without a live session cannot record recovery state; their failure policy remains explicit implementation scope rather than an adapter fallback.
