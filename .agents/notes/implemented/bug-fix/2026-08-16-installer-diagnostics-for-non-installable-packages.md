# Agent Note: Installer diagnostics name the remedy for non-installable packages

Status: implemented

English | [中文](2026-08-16-installer-diagnostics-for-non-installable-packages.zh.md)

## Problem

Two upstream package shapes make `pnpm add` succeed while the installed result is unusable, and both previously surfaced as misleading installer failures:

1. A git dependency whose repository root has no `package.json`. pnpm installs a placeholder manifest (`_pnpmPlaceholder`), and `readProfileIdentity` then reported "pnpm-installed package X has no valid package.json name" — blaming the package instead of naming the monorepo structure that caused it. A real failure of this shape: `github:whitelonng/dsh-plugin-describe-image`, whose plugin lives in `packages/vision/tool-describe-image`.
2. A package manifest that still carries `workspace:`-protocol dependencies (a package copied out of the harness monorepo). pnpm fails with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`, and the installer surfaced only the raw pnpm output tail, which does not say what the publisher must change.

## Decision

`readProfileIdentity` detects the pnpm placeholder manifest and throws a diagnostic that names the remedy: reinstall with a `#&path:` selector naming the plugin subdirectory. `installViaPnpm` detects `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` in the pnpm output tail and appends the remedy: replace `workspace:` ranges with concrete published versions and mark harness peer dependencies optional so pnpm does not auto-install stale published copies over the healed profile module fallback. Both detections live beside the surfaces they diagnose; no new package or service.

## Alternatives considered

**Fix each broken upstream package only.** Rejected because the package registry cannot be policed: any user can install any repository, and the installer is the only surface every install passes through, so its diagnostics are the one place a remedy can be guaranteed to reach the operator.

**Pre-process the installed manifest (rewrite `workspace:` ranges during install).** Rejected because version selection for each rewritten range is the publisher's decision — the harness cannot know which published version matches the package's build — and silently rewriting dependencies hides a publishing defect the operator should fix upstream.

**Probe the repository root before `pnpm add`.** Rejected because the probe would need its own git/network path and duplicate pnpm's resolution of branches, commits, and selectors; detecting the placeholder pnpm actually wrote stays truthful by construction.

## Consequences

A root-without-`package.json` install and a `workspace:`-range install now both fail with one-line-per-remedy diagnostics. The profile manifest is left with the added dependency on both failure paths (as before); the operator repairs the spec or the upstream manifest and reinstalls. Unit coverage pins the placeholder rejection text and the workspace-protocol remedy suffix; the successful path-selector and root-manifest installs of the `dsh-plugin-describe-image` fork were exercised end to end against the live profile.

## Related

[pnpm delegation and plugin discovery](../../implemented/architecture/2026-08-15-pnpm-delegation-and-plugin-discovery.md) owns the delegated install path these diagnostics extend.
