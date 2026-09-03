# Agent Note: Inspector console tests prove subscriptions before broadcasting

Status: implemented

English | [中文](2026-09-03-inspector-console-broadcast-subscription.zh.md)

## Problem

The integration test "forwards Client Console objects through isolated realm sessions" intermittently lost the recorded console event: a connected CDP session asserted on `Runtime.consoleAPICalled` never observed it, and no wait budget fixed the failure. The Inspector's console path buffers nothing. `executionContextCreated` is announced as soon as a session attaches its console domain, but the client adds the session to its fan-out set only after processing the `client-console/enable` frame across the bridge, and both the worker's runtime router and the client drop console frames for sessions without a live subscription. An event emitted inside that window is lost for good, and polling (`vi.waitFor`) only re-reads a per-session buffer that never received the frame.

## Decision

The test emits a sentinel console event inside its wait and re-emits it until both CDP sessions observe it; only then does it emit the event under test once. Observing the sentinel proves both subscriptions are live, after which the unbuffered broadcast deterministically reaches both sessions. The test states this broadcast contract in its comment and carries an explicit test-level budget covering the two waits.

## Alternatives considered

**Widen the wait.** Tried first (wait widened from one second to five) and rejected: polling re-reads a buffer that never received the dropped frame, so a longer wait cannot recover a broadcast lost before subscription; it only narrows the window and failed again under the coverage lane's concurrency.

**Make the Inspector buffer or replay console broadcasts for late subscribers.** Rejected: that is a product change — memory cost and replay semantics per session — unjustified by a test-only flake; the existing best-effort broadcast contract is the behavior under test.

**Assert subscription state directly before emitting.** Rejected: the subscription set lives inside the client's console observer and is not exposed over CDP; observing a sentinel event is the external, contract-level proof available to the test.

## Consequences

The test no longer flakes on subscription timing and pins the real contract: console broadcast is best-effort for sessions whose enable frame has not been processed. Wait budgets stay bounded instead of growing with machine load, and a future drop of the recorded event now indicates a real fan-out regression rather than a race in the test itself.
