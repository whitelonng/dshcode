# Agent Note: Subagent reports precede their settlement notices

Status: implemented

English | [中文](2026-08-17-subagent-report-settlement-ordering.zh.md)

## Problem

A continuable child can explicitly report selected content and later produce an unconditional manager-authored settlement notice. Report delivery used `Agent.followup()` and entered the parent's `next-turn` queue, while settlement delivery to a running parent used `Agent.steer()` and entered `next-step`. The first step of a turn claims the complete `next-step` batch before one `next-turn` message, so the later settlement notice could reach the model before the earlier report. The assembled report scenario required `reportDelivery: quiet` to avoid that nondeterministic interleaving. [Issue #2600](https://github.com/deepseek-harness/deepseek-harness/issues/2600) records the defect.

The report tool tells a child to report whenever a finding changes what its parent should do next. Deferring that message to a later turn contradicted the tool's scheduling meaning and separated causally ordered messages across queues with different claim priority.

## Decision

`SubagentReportDelivery` is `'quiet' | 'next-step'`, and `next-step` is the default. Next-step delivery calls `parent.steer()`, so a running parent reads the report at its nearest safe step boundary and an idle parent starts a turn. Quiet delivery continues to call `parent.inject()` and enters the same queue without waking an idle parent.

The continuation manager retains `sendWaking()` and `admitWaking()` around next-step reports delivered to resident continuable parents. Their purpose is waking-send admission accounting, independent of whether the message targets a step or a turn: the receiving Activation remains live between synchronous inbox insertion and the microtask that observes the wake.

### Ordering across parent states

A running parent receives an accepted report and the child's later settlement notice in the same `next-step` FIFO. If the parent becomes idle before settlement arrives, it has already claimed the report; settlement may then open a later turn without reversing the observed order.

During parent maintenance, the report occupies `next-step` and latches a wake, while settlement may occupy `next-turn` because maintenance reports idle status. The initial claim still takes next-step input before the queued turn. Waking input submitted after cancellation is redirected by `Agent.send()` to `next-turn`, so report and settlement follow the core agent's cancellation convergence rather than bypassing it.

### Verification

The report package holds a parent inside an active model request, submits a child report, settles that child, and asserts the pending parent batch is ordered `subagent-report`, then `subagent-settled`, with no queued later turn. Separate coverage pins repeated reports as one FIFO next-step batch, idle-parent wakeup, and waking admission accounting for a continuable parent.

The assembled ACP report scenario uses the shipped default. Its scheduling fence keeps the child behind the parent's delegation turn and holds the parent in maintenance until settlement follows the report. The report latches the wake while the settlement notice queues a turn; when maintenance ends, the parent claims next-step input before next-turn input and observes both notices in causal order without a quiet-delivery overlay.

## Alternatives considered

**Keep the `wakeup` name but change its implementation to `steer()`.** The existing public description defined `wakeup` as one later parent turn. Reusing the value for a different inbox target would leave configuration unable to state the behavior it selects. The pre-release configuration instead names `next-step` directly.

**Expose `quiet | next-step | next-turn`.** A next-turn report still permits a later next-step settlement notice to overtake it. Preserving report-before-settlement would require a cross-queue ordering barrier, and no current deployment requires next-turn isolation strongly enough to own that mechanism.

**Move settlement notices to `next-turn`.** Settlement batching deliberately uses the next-step queue so several children finishing together cost one parent step instead of one turn each. Moving settlement would increase latency and model work to retain a report scheduling mode with no current consumer.

## Consequences

- A report may extend an open parent turn. It never interrupts the active model request or tool execution; the agent loop admits it only at a step boundary.
- Reports accepted together share one next-step batch, preserving FIFO order and reducing the turn amplification of the former one-turn-per-report behavior.
- The `wakeup` configuration value is rejected rather than retained as an alias. This repository has no external pre-release compatibility promise for Cordis configuration.
- `quiet` remains the deployment escape for reports that must not wake a parked parent, with the existing risk that no model reads them until another waking input arrives.
