# Agent Note: Deleted stale and duplicative knip.json workspace entries

Status: implemented

English | [中文](2026-08-19-knip-config-cleanup.zh.md)

## Problem

`knip.json` carried workspace entries that did no work. Some pointed at packages that no longer exist, and some duplicated the `packages/*/*` glob default exactly. Both kinds made the file larger — 790 lines — and signaled a config that had outgrown the packages it described, so a reader could not tell which entries protected real behavior and which were inert.

## Decision

Deleted 15 `workspaces` entries: 2 stale keys naming packages absent from the working tree and from `HEAD`, and 13 entries whose `entry`/`project` values were byte-identical to the `packages/*/*` glob default.

- Stale keys: `packages/util/home` (removed in `4a09d9b34d`, the harness-home resolver collapse) and `packages/client/web-ui` (no directory and no git history, an orphan key). knip 6.16 does not flag stale workspace keys — that stability check arrived in knip 6.18 — so these were inert config that only deleted when their packages disappeared.
- Glob-duplicate entries: `packages/host/webserver`, `packages/client/runtime`, `packages/core/tools`, `packages/context/tmux-context`, `packages/util/timeout`, `packages/util/output-retention`, `packages/goal/goal-round-driver`, `packages/goal/tool-goal`, `packages/util/home-paths`, `packages/fs/tool-fs-search`, `packages/client/ui-settings`, `packages/client/modules`, `packages/client/hmr`. Each declared exactly `entry: ["tests/**/*.spec.ts"]` and `project: ["src/**/*.ts", "tests/**/*.ts"]`, which equals the `packages/*/*` glob, and each package still exists, so the glob now covers it identically.

The change is a deletion only: `knip.json` went from 790 to 655 lines with no behavioral change. `pnpm run knip` runs clean (zero issues, exit 0) before and after, because knip selects one workspace config per matched key (`getConfigKeyForWorkspace` uses specificity, not array merge), so a removed entry either lost an unresolvable target or fell back to an identical glob config.

## Alternatives considered

- Fold `zod` and other workspace-level `ignoreDependencies` up to the root. Rejected: the root `ignoreDependencies` is a repository-wide fallback, and these exemptions are deliberately workspace-scoped (the README of `cordis-host-runner` records why `src` cannot import the flagged dependency while the generated TypeRT face in `lib` needs it). Widening scope would mask a genuinely misplaced dependency in any future package.
- Upgrade knip to 6.18+ to get an automatic stale-workspace check. Deferred: 6.32.2 (latest at the time) re-flags many `@deepseek-ai/...` test dependencies as unused, i.e. it changes analysis semantics, not just adds hints. That is a separate dependency-upgrade decision with its own CI blast radius, not part of this cleanup.
- Keep the entries as documentation of intent. Rejected: an entry identical to the glob it sits under documents nothing beyond the glob itself, and a key naming an absent package actively misleads.

## Consequences

- `knip.json` is 135 lines shorter and names only packages that exist with config that differs from the glob default.
- Still-explicit entries (54) all carry a real reason to differ — an `e2e`/fixture/tsx `entry`, a `project` outside the default, or a workspace-scoped `ignoreDependencies`.
- knip 6.16 cannot itself detect the next stale key, so a package removal must still remember to drop its `knip.json` key; upgrading to 6.18+ (after the analysis-semantics change is separately assessed) restores that guard.
- This realizes the "never a restatement of the default stanza" criterion of the package-inventory proposal ([topic](../../proposed/process/2026-06-20-discover-package-inventory.md)); its remaining items — the e2e entry folding and the generated inventory — stay open there.
