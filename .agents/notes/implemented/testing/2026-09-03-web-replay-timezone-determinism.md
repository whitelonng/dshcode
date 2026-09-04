# Agent Note: Web replay pins the recorded time zone

Status: implemented

English | [中文](2026-09-03-web-replay-timezone-determinism.zh.md)

## Problem

Committed web goldens persist the client's IANA zone: every user message records `clientTimeZone` in its source metadata, and scenario fixtures replay that data verbatim. Upstream records and replays these goldens on its own runner pool, whose hosts run in Asia/Shanghai, so the committed fixtures all say `clientTimeZone: "Asia/Shanghai"`. This fork replays the same suite on GitHub-hosted runners in UTC, where a freshly driven session renders `clientTimeZone: "UTC"` and every session-bearing scenario failed replay against the Shanghai-recorded goldens. Repeated golden refreshes could not fix this: each host records its own zone, so a golden checked in from one host fails on every other host, and the replay result depended on which machine recorded it.

## Decision

The shared page helper `newEnglishPage` pins the Playwright page to `Asia/Shanghai` alongside its locale and viewport before client boot, so every recorded and replayed session carries the committed goldens' zone regardless of host. Refresh remains the only golden writer, and refresh drives pages through the same helper, so recording and replay produce identical `clientTimeZone` values on any host. Scenarios that deliberately vary the zone, such as schedule-after, set their own explicit `timezoneId` and are unaffected.

## Alternatives considered

**Normalize `clientTimeZone` out of the goldens.** Rejected: the zone is genuine persisted source metadata the product records for every user message; projecting it out would hide a real host variable instead of removing it, and would diverge this fork's fixture format from upstream's.

**Refresh the goldens on the CI runner and push them back.** Rejected: the fork CI holds no write permission by its own read-only contract test, a PR checkout is a synthetic merge at a detached HEAD so that push is always rejected non-fast-forward, and per-host goldens would still make replay host-dependent — each host's record stays wrong on every other host.

**Run the fork's CI on Shanghai-zone self-hosted runners.** Rejected: hosting and operational cost for a fork, and local developer machines would still record their own zones.

**Set the `TZ` environment variable for the test process.** Rejected: the supported way to fix a browser page's zone is Playwright's `timezoneId`; an environment variable does not deterministically control the rendered page's Intl zone across browser builds.

## Consequences

Replay is zone-stable across developer machines, UTC hosted runners, and the recording host, and the goldens keep recording `clientTimeZone: "Asia/Shanghai"` exactly as upstream's do. The pin and the committed goldens must agree: recording through a different zone reintroduces the host dependence, and a missing pin resurfaces as the `clientTimeZone` diff on any UTC host the next time the lane replays.
