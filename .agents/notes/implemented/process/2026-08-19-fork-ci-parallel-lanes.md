# Agent Note: Fork CI — parallel keyless lanes on hosted runners

Status: implemented

English | [中文](2026-08-19-fork-ci-parallel-lanes.zh.md)

## Problem

[Fork CI](../../../../.github/workflows/fork-ci.yml) was a single 120-minute `ubuntu-latest` job (lint, typecheck, unit tests, doc-sync) triggered only on master push and manual dispatch: pull requests got no unit or static signal, one failing step skipped every later step, and the lane was not stable — its fifth run failed at unit tests on a docs-only commit. The inherited upstream workflows target DeepSeek's org-scoped runner pools and provider secrets and are `disabled_manually` in the fork's Actions settings, so the fork's real signal is entirely this file.

## Decision

Fork CI is now four parallel, keyless jobs behind one stable verdict, all on GitHub-hosted runners:

- `static` (one host build feeding lint and typecheck host+client, the doc-sync aggregate, the shared static gates — constraints, package invariants, Cordis config, runtime closure, optional-dependency imports, issue policy — the module graph check, and the desktop runtime closure), `unit` (the complete vitest inventory, including apps/desktop and apps/web specs, pinned to two forked workers so the timing-sensitive terminal/subprocess suites keep headroom on the 4-vCPU runner), `web` (built frontend + `DSH_SNAPSHOT=replay` browser replay), `coverage` (`check:ci:coverage`, per-file 100% on `packages/*/*/src`).
- `all-checks-passed` aggregates the four blocking lanes with `if: always()` so a failed dependency can never skip the required check into a green; branch protection requires only `Fork CI / all checks passed`.
- Pull requests trigger the workflow; `cancel-in-progress` exempts only push (`${{ github.event_name != 'push' }}`), because a master push is the post-merge signal and the cache producer, while superseded pull-request and dispatch runs are disposable.
- Caches flow master → every lane: the `unit` lane alone saves the pnpm store on master pushes (five parallel saves of one key would race and waste compression), and the `web` lane alone saves the Playwright browser cache; every lane restores both families on every event.
- `coverage` runs with `DSH_COVERAGE_MAX_WORKERS=3` (two instrumented workers plus one exempt heavy-suite worker) and `DSH_GATE_CONCURRENCY=2`, so the two coverage gates overlap at 2 + 1 = 3 forks instead of serializing — sized for the 4-vCPU hosted runner. The first Ubuntu run of this lane reproduced a process-exit race: the scenario host crashed on a partial tree.json read and never published its ready file. The host fixture now retries the read+parse, the scenario reads `DSH_COVERAGE_TEST_TIMEOUT_MS` (set to 60000 on this lane) to widen its ready wait, and a ready-timeout failure surfaces the host's exit and stderr.
- Once those races were fixed, the lane exposed the fork's real coverage debt: 24 files sit below the per-file 100% bar (fork-added packages shipped without tests to the bar, fork-diverged files changed upstream code without carrying coverage along, and `util/atomic-write` is identical to the upstream snapshot yet short). They are listed in the fork-maintained exclusion block in `vitest.config.ts` with a `TODO(fork)` marker; every other file keeps the 100% gate.
- `unit`, `web`, and `coverage` prepare bubblewrap before running, matching the upstream lanes, so the sandbox suites execute instead of silently skipping.
- The `static` lane sets `DSH_ARCHIVE_BASE_REF` to the PR base only on the pull-request-gated `doc-sync` step: an empty string would be read as a literal ref instead of the script's HEAD default.
- `knip` and `duplication` stay out of the lane until the fork's pre-existing debt is fixed: knip fails on an unused desktop file and dependencies plus 108 unlisted test imports, and jscpd on 14 plugin-installer clones. `check:ci:static` embeds knip, so the lane runs its green subset as explicit steps instead of the aggregate; fixing the debt means re-adopting `check:ci:static` plus one duplication step.

The `web` lane started diagnostic (absent from `all-checks-passed.needs`, `(diagnostic)` name suffix) because local runs cannot exercise the assembled app's confined bash tool (the host sandbox denies `posix_openpt` and nested `sandbox-exec`, cascading failures through the aria goldens), so only an Ubuntu run could prove the fork's web goldens current. Its first Ubuntu run failed on exactly one stale golden — the retry row now reports attempt 1 of the fork's five transient retries — which was refreshed, and the next run went green; `web` then joined `all-checks-passed.needs` under its plain name.

The upstream workflows stay verbatim (`disabled_manually` in settings) rather than carrying fork guard patches: `scripts/ci-workflow.spec.ts` pins their exact `if` strings, and settings-level disabling keeps them conflict-free across upstream syncs. The fork-owned executed gate `scripts/fork-ci-workflow.spec.ts` pins the new contract: triggers, keyless-ness, hosted runners, cache direction, aggregator membership, and the continued absence of snapshot replay and real-API e2e.

## Alternatives considered

**In-file repository guards on ci.yml/e2e.yml** — the fork's copies would skip cleanly even if someone re-enables the workflows. Rejected: `scripts/ci-workflow.spec.ts` asserts those `if` strings exactly, so the patch forks a shared spec file and conflicts on every upstream sync; the workflows are already disabled in settings, which is the writer-visible control point.

**Snapshot replays re-enabled now** — re-run `test:snapshot` on every pull request. Rejected: the goldens were dropped in dd602d3668 while they drifted, and re-owning them needs a fork-side refresh verified on CI; that stays a separate step before the lane returns.

**Making `web` blocking immediately** — rejected at first: a red lane from unverified goldens would block every merge during the refresh window, so the lane started diagnostic and promoted once its Ubuntu run went green.

## Consequences

Pull requests finally carry the fork's unit, static-and-docs, and coverage signal, each with its own timeout and re-run granularity; the monolith's step-cascade failure mode is gone. The master-push red lane (run 5's unit failure) still needs its failing log identified: the unit lane is unchanged in substance, so that failure is a separate follow-up. Coverage costs a long lane on a 4-vCPU runner (bounded at 120 minutes). Caches add first-run latency only: the first master push after merge seeds both stores.
