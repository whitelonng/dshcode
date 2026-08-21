# Agent Note: Composer edits carry the range they applied to

Status: implemented

English | [中文](2026-08-20-composer-edit-range-from-selection.zh.md)

## Problem

The input machine keeps its reference occurrences aligned by reconciling them against one edit range: entries before the range shift, entries after it hold, and an entry the range intersects loses its structured identity and stays behind as ordinary draft text. That last rule is the deliberate meaning of editing inside a reference.

Ordinary typing supplied no range. A controlled textarea's change event carries only the resulting string, so the machine recovered the range by scanning the two drafts for a common prefix and suffix. That recovery is ambiguous whenever the inserted text repeats the text it lands against, and the greedy scan always resolves the ambiguity the same way: it slides the edit as late as the characters allow.

A reference renders as `@` followed by its label, so typing `@` immediately before one produces exactly that collision. The user inserts at the reference's own offset; the scan reports an insertion one character later, inside the reference; reconcile applies the intersect rule and drops the occurrence. Deleting a character in front of such a reference slides the same way.

The draft then still reads correctly to the eye while carrying no structured reference, and submission takes the occurrence-free path that sends the draft verbatim. The host receives the human-facing label instead of the owner's model form and resolves nothing. The serialization guard that exists to prevent exactly this downgrade never runs, because it only fires when an occurrence survives to be serialized.

This became reachable when references [became literal inline text](../feature/2026-07-27-web-file-and-session-references.md). A reference previously occupied one `U+FFFC`, a character no keystroke produces, so the scan had nothing to collide with.

## Decision

`InputBar` records the textarea's selection and `inputType` during `beforeinput` and passes the resulting range to `setDraft`, which the machine already accepts and prefers over its own scan. A textarea exposes the edit no other way — `getTargetRanges()` is empty for form controls.

An edit that replaces a selection reports that selection, and it is the range outright; the inserted length is whatever the draft grew by once the replaced range is accounted for. A caret delete replaces nothing and reports the bare caret, so its range comes from the direction `inputType` names and the number of characters the draft actually lost. The count is measured rather than assumed to be one, because a single caret gesture removes a multi-unit grapheme, a word, or a line just as readily. Chromium, WebKit, and Firefox all report the collapsed caret for `deleteContentBackward` and `deleteContentForward`, and all three derive the same range from it.

Only the `insert` and `delete` families are recorded. A history replay reports wherever the caret happens to sit, which would survive every check while naming the wrong span; ignoring it leaves that path on the scan.

The record is consumed once and cleared. A record whose draft length disagrees with the draft the change reports, a selection past the draft, a shrinking edit over a selection the caret cannot explain, or an undirected delete all yield no range, and the machine falls back to its scan. Paste and the boundary Backspace and Delete gestures already supplied their own ranges and are untouched.

## Testing

Component tests cover the trigger character typed in front of a reference, a caret Backspace, a caret Delete, a caret word delete, and a delete over a selection, asserting in each case that the occurrence survives at the shifted offset. The caret cases fail against the scan-recovered range, and the word case fails against a fixed one-character step.

An assembled browser scenario drives the same gestures as real key presses against the shipped composition, which is the only place the range an engine reports for them can be observed; its golden projects the backdrop's segments, since the decoration layer is aria-hidden and the accessibility tree cannot see the chip. A real composition driven through the browser's IME path reports the composing segment as the selection at every intermediate state, and the reference survives each one.

## Alternatives considered

**Disambiguate the scan with the post-edit caret.** The caret pins which of the textually equivalent readings happened, and the change event already carries it. Rejected because it keeps a reconstruction where an exact fact is available, and it cannot separate the deleted and inserted halves of a replaced selection at all.

**Give references a leading marker no keystroke produces.** A private-use character in place of the literal `@` removes the collision at the representation level, and the reject list for pasted text already names that range. Rejected because it re-adds a character that every serialization, selection, and accessibility path has to strip, to buy what an exact range buys directly, and it would leave ordinary typing reconstructing its range for every other reason.

**Widen reconcile to keep an occurrence when the range only touches its edge.** Rejected because the misattributed offset lands strictly inside the reference, not on its boundary, so the rule change would not reach this defect while making the intersect rule vaguer.

## Consequences

Every native textarea edit that reaches `onChange` now names the range it applied to, so occurrence offsets follow the edit that actually happened rather than one merely consistent with the resulting characters. Draft writes that originate in the facade rather than the DOM — `insertText` and the command-token splices among them — still carry no range and keep the scan, as do the fallbacks above.

The composer now depends on `beforeinput` preceding each value change, and on `inputType` naming the direction of a caret delete. Any future edit path that mutates the value without either silently returns to the scan rather than breaking, which keeps the failure mode the old behavior instead of a wrong range.
