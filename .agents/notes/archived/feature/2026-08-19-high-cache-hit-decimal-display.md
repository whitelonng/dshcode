# Agent Note: High cache-hit decimal display

Status: implemented
Archived: 2026-08-22

English | [中文](2026-08-19-high-cache-hit-decimal-display.zh.md)

## Problem

The Web conversation stats line rounded every non-empty cache-hit ratio to an integer. Once the actual ratio passed 99%, the display hid further progress, and a ratio of at least 99.5% appeared as 100% even while uncached input or cache writes remained.

Users therefore could not distinguish a nearly complete cache hit from a true full hit.

## Decision

`StatsLine` continues to derive the ratio from the whole-session `tokenUsage` projection owned by `@deepseek-ai/dsh-token-meter`; the projection remains the only owner of the uncached-input, cache-read, cache-write, and output counts ([projection decision](../architecture/2026-07-29-projected-token-usage-and-request-context.md)). The presentation layer changes only the text inserted into the existing `stats.cacheHit` locale template.

| Actual ratio | Display |
|---|---|
| No billed input | Cache-hit group omitted |
| Integer rounding is below 100% | Rounded integer |
| Non-full ratio whose current rounding is 100% | Minimum decimal precision whose rounded result is below 100% |
| 100% | `100%` |

Every non-empty ratio starts at zero decimal places. A non-full ratio increases precision one place at a time only while rounding would produce 100%, so `99.1%` and `99.49%` remain `99%`, while `99.5%`, `99.95%`, and `99.995%` retain one, two, and three decimal places respectively. `StatsLine` uses exact small-factor comparisons over the safe-integer token counts, then scales the near-full gap only while the intermediate remains within that range. This avoids floating-point tie errors without imposing a precision cap or substitute label. A full hit does not carry a redundant decimal. The same derived string feeds the inline row and its overflow tooltip.

## Ownership and lifecycle

Token-meter continues to fold usage from the complete durable session log. `StatsLine` performs a synchronous display derivation whenever the standard projection value changes. It introduces no setting, stored percentage, event, wire field, client state, or recovery path.

Live updates, reload replay, and reconnect recovery all restore the same `tokenUsage` counts and run the same display function. A missing projection still omits every token group, and a zero input denominator still omits only the cache-hit group.

## Verification

The component spec pins the zero denominator, ordinary integer rounding, half-step rounding at several decimal precisions, each precision boundary through three decimal places, a near-full cumulative sample that needs fourteen decimal places, the true `100%` result, both locales, and equality between inline and tooltip values. The assembled `lifecycle-chrome` replay sidecar selects `9,950 / 10,000 = 99.5%` as a deterministic ratio that integer rounding would misreport as 100% while the base session fixture remains recordable; the live assertion and post-reload browser snapshot both display `99.5%` without another model call.

## Alternatives considered

**Keep integer rounding for every ratio.** Rejected because it hides all movement above 99% and still reports some non-full hits as 100%.

**Truncate the high band to one decimal.** Rejected because `99.95%`, `99.995%`, and still closer ratios all collapse to `99.9%` instead of retaining the minimum precision that distinguishes them from a full hit.

**Cap precision and use a substitute such as `<100%`.** Rejected because the exact cumulative counts can produce the required numeric result, and a cap would make display behavior depend on an arbitrary presentation limit.

**Show one decimal at every ratio.** Rejected because the additional low-band motion adds noise and changes the established display where integer precision is sufficient.

**Persist a display percentage in token-meter.** Rejected because the projection already carries the exact counts, while presentation precision belongs to the Web stats line. A second stored value would duplicate derivable state and expand replay and wire responsibilities.

## Consequences

High cache-hit sessions remain visually stable until integer rounding would falsely report a full hit, then expose only the decimal places needed to preserve that distinction. Extremely close non-full ratios can therefore produce long decimal strings; this is the accepted cost of having no arbitrary precision cap or nonnumeric fallback. Every delivery and recovery path stays on the existing durable projection lifecycle.
