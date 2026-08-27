# Agent Note: Composer Tab completes the leading slash command as text

Status: implemented

English | [中文](2026-08-22-composer-tab-completes-trigger-menu.zh.md)

## Problem

While the `/` or `@` trigger menu was open in the composer, the Tab key fell through to the browser's default focus walk: the textarea lost focus to the next focusable control (the toolbar command button, the model seat, the Send button), and the keystroke never completed the command the user was filtering for. A first attempt at the fix made Tab pick the highlighted candidate like Enter, but that was wrong for this gesture: ui-commands' pick path executes argument-less (bare) host commands immediately (`runDetached` in `packages/client/ui-commands/src/client/service.ts`), so a Tab on the open `/` menu could run a command instead of completing its name into the draft.

## Decision

**Tab completes text; it never picks.** `ArbitrateKey` gains `'tab'` in `packages/client/ui-input-trigger/src/types.ts`. The controller's `arbitrate` routes `'tab'` to a dedicated `complete(state)` arm: for a leading `/` token with a highlighted ready candidate it splices `/<name> ` (the trigger, the candidate name, and a trailing separator) over the token span through the scoped `slash/input-insert-text` event — the same plain-text insertion path sources' `{ text }` outcomes use — then closes the menu. The draft stays plain text, so Enter-time adjudication (`matchEnter`) claims or executes the command exactly as if it had been typed by hand. Every other open-menu state — no highlight yet, an inline token, or the `@` trigger — consumes the key without acting, so the browser's focus walk cannot escape the composer while the menu is up. A closed menu, IME composition, or disposal answers `'pass'`.

**The composer routes Tab through the same arbitration and prevents the focus walk.** `InputBar.onKeyDown` intercepts `Tab` after the Escape branch: it calls `keyboard.arbitrate('tab', composing)` and preventDefaults exactly when the outcome is not `'pass'`. The workspace-trigger and absent-machine paths return before the branch, so nothing outside a live menu changes.

## Alternatives considered

**Tab picks the highlight like Enter.** Rejected after it shipped in the same change: the pick path is the source's execution path, and a bare host command executes on pick — Tab completed by running the command, which is exactly what a completion gesture must not do.

**A new per-source completion hook in the frozen trigger contract.** Rejected: the candidate name is the completion text for commands, and the plain-text insert path already exists; a contract extension would buy nothing for this gesture.

**Consume Tab only when a completion exists.** Rejected: while candidate groups are still pending, Tab would walk focus out of the composer, reproducing the original defect; consuming the key with no completion to offer is better than losing focus mid-interaction.

**Handle Tab inside MenuView instead of the composer.** Rejected: focus never enters the menu (combobox pattern — rows pick on mousedown and the textarea keeps focus), so the menu receives no key events; the textarea's keydown is the only interception point.

## Consequences

Tab on the open slash menu completes the highlighted command's name into the draft and keeps focus in the textarea; the command runs only when the user submits the completed line. The `@` reference menu and inline tokens consume Tab without completing — their pick outcomes carry structure (reference chips, popups) that a bare text splice would corrupt, so Enter/pointer remain their pick gestures. Enter is unchanged. The `ArbitrateOutcome` union is unchanged; tab always answers `'consumed'` or `'pass'`. The popupSelect command popup (the plus-button surface) keeps its own key handling and is unaffected.

## Testing

`packages/client/ui-input-trigger/tests/service.client.spec.ts` pins the controller arm: tab splices `/<name> ` through the scoped insert-text event without invoking onPick, consumes without acting on inline tokens and the `@` trigger, passes during IME composition and on a closed menu, and consumes while groups are pending. `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` pins the DOM routing: a consumed arbitration preventDefaults the Tab keydown (no focus walk) and a `'pass'` arbitration leaves it native.

## Related

- [Web input machine and slash pipeline](../architecture/2026-07-25-web-input-machine-and-slash-pipeline.md) — the trigger pipeline whose arbitration this extends.
