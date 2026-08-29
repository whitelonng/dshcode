# Agent Note: Composer reference decorations key by draft-order ordinal

Status: implemented

English | [中文](2026-08-20-composer-reference-decoration-keys.zh.md)

## Problem

The composer backdrop renders the draft as an array of segments: plain strings, a leading claim-token mark, one element per structured reference, and one mark per plain-text reference range. React reconciles that array by key.

Structured references carry an identity — the occurrence table mints an `occurrenceId` that survives every edit — so their chips key by it. Plain-text reference ranges have no such identity: `scanTextRefs` re-derives them from the draft on every render, and nothing outside that scan remembers a range between two keystrokes.

Keying those ranges by their draft offset made the key change whenever earlier text changed length. React then treated the range as a different element, unmounted the mark with its nested spans and inline glyph, and mounted a replacement. Every character typed or deleted ahead of a reference rebuilt every reference after the caret, and the work grew with the reference count. [Directory-syntax ranges](../feature/2026-07-27-web-file-and-session-references.md) made that path routine: they match on `@path/` syntax without a lexicon, and each one renders an icon.

## Decision

A plain-text reference mark keys by its index in the offset-sorted `textRefs` list, computed where the boundary list is assembled so a skipped boundary cannot shift it. The scan already returns the ranges in draft order, so the ordinal names the render slot a range occupies, which is the only identity a scan-derived range has.

Structured chips keep `occurrenceId`. The two key strategies differ because the two range kinds differ in identity, not by oversight: a range the occurrence table owns keeps its node across reordering, and a range only a scan knows keeps its node across offset shifts.

A range that stops matching the scan still loses its decoration, because it disappears from `textRefs` and the ordinal it held no longer exists.

## Testing

A component test holds the mark element and its glyph, types a character ahead of the range, and asserts the same nodes are still mounted; it then edits the token out of match shape and asserts the decoration is gone. The test fails against an offset-derived key.

## Alternatives considered

**Key by the range text.** Rejected: duplicate references collide on one key, and editing inside a range changes its key, which reintroduces the remount this fixes.

**Give scan-derived ranges an identity table.** Rejected: it adds mutable state whose only consumer is a render key, and the scan would have to diff against the previous draft to maintain it. An edit that breaks a match simply dropping the range on the next scan is what keeps `scanTextRefs` a pure derivation.

**Drop the keys and let React match by position.** Rejected: React requires keys on elements inside an array, and the plain string segments between them already match by index, so an unkeyed element warns without changing the outcome.

## Consequences

Typing ahead of a reference updates text nodes only; the mark and its icon stay mounted. The backdrop's per-keystroke DOM work no longer scales with the number of references in the draft.

Because the key names a position, inserting a reference ahead of existing ones reuses the earlier nodes with new content instead of re-creating them. That is correct for these marks, which hold no focus, selection, or animation state, and it is the condition any future decoration on this layer meets before it keys by ordinal.
