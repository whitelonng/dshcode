# Agent Note: narrow-viewport plan chip click-area regression test

Status: implemented
Archived: 2026-08-22

English | [中文](2026-08-06-plan-narrow-viewport-regression.zh.md)

## Problem

The external report dsh-external/issues#107 (clustered internally as deepseek-harness#1406) measured that at viewports between 760px and 850px the plan control and the model selector overlapped, with the model selector covering the plan control's click area so plan mode could not be left by mouse at 800×720. Its acceptance list asked for a browser regression test asserting that the plan center hit-tests to the plan button.

The browser regression test reproduced the report on current master: at 800×720 the plan chip and the model trigger overlapped by 36.9px and the chip's center hit-tested to the trigger's label. The composer control row is `display: flex; justify-content: space-between` with `.trailing { flex: none }`: when the combined control width exceeds the card, the shrinking `.tools` group keeps its flow children inside its `min-width: 0` box, so the chip — the last flow child before the overflow — is painted over the trailing group. The plan-control form changed since the report (select → chip, `c20b988166`/`fe91919346`) and the row gained adaptive behavior (`c8c75ec891`, [web-composer-shared-width-axis](../feature/2026-08-04-web-composer-shared-width-axis.md)), but the row had no wrap, so the overlap survived both.

## Decision

The row wraps instead of shrinking its left group into the right group's area: `.row { flex-wrap: wrap }` plus `margin-left: auto` on `.trailing`, which re-anchors the trailing group (model + send) to the right edge of its wrapped line while `space-between` already pins it right on a single line. Wrapping is the acceptance's "wrap, fold, or re-arrange controls when space runs out" option, keeps every control at full width (no label folding that would hide the model name or the Plan wordmark), and holds at every viewport width by construction instead of at a calibrated container-query threshold.

Add `apps/web/tests/plan-control-row.e2e.ts`: enter plan mode with the real `/plan` command (no argument — the command handler commits plan/mode active without a model round, the lifecycle-chrome precedent), so the test needs no model call in any mode and no API key in replay/refresh; a providers-only fixture mounts the model catalog without a script to consume. The file joins the host-plane e2e pairing like every sibling: excluded from the client graph in `apps/web/tsconfig.json` (it imports host-plane types) AND included in the host aggregate in `tsconfig.host.json`, so exactly one TypeScript program owns it — the pairing that also gives the lint type service its program.

The geometry golden records stable facts — viewport membership on both axes and disjoint click areas — never absolute coordinates, whose pixel values depend on installed fonts and differ between macOS and Linux. The behavior assertions implement the acceptance directly: the click areas are disjoint, the click at the chip's center (Playwright's actionability check) leaves plan mode through the real command channel (`/plan off` via `commands.execute`), and the last `plan/mode` event in the session log flips inactive.

## Alternatives considered

**Seed a cold session (composer-tab-geometry pattern).** Rejected: the exit path executes `/plan off` through `commands.execute`, which needs the live agent a cold seeded session does not have; `connectFreshWorkspace` keeps one, matching the product's user path.

**Pin absolute bounding boxes in the golden.** Rejected: chip and trigger widths depend on the installed fonts, so absolute coordinates would churn across platforms without a behavior change.

**Reuse the plan-review fixture shape (exit_plan_mode review takeover).** Rejected: the takeover replaces the composer's control row, which is the surface under test.

**Container-query label folding for the chip and/or the model trigger.** Rejected for the fix: two packages (ui-plan, ui-model) would need calibrated thresholds and the chip's own icon-only fold still leaves ~7px of overlap at the reported viewport unless the trigger folds too. Wrapping is one rule in one package and holds at every width.

## Consequences

Any future change to the control row layout — fonts, gaps, media or container queries — that re-introduces overlap or moves the chip out of the viewport on either axis fails this test. The test needs no API key in replay/refresh modes: plan mode toggles through the command handler without a model round, and a providers-only replay fixture (no recorded script, consumption check skipped) mounts the model directory so the trigger renders its real long label — the width that made the reported overlap measurable; the test asserts that label before measuring. The golden is compared in replay and record modes and rewritten in refresh mode.
