# Agent Note: Sync the DSHCode fork to upstream dsh-v0.1.1-rc.2

Status: implemented

English | [中文](2026-08-21-dshcode-sync-upstream-011-rc2.zh.md)

## Problem

The fork master carries the DSHCode desktop product on a dsh 0.1.0-rc.8 base while upstream advanced 207 commits to dsh-v0.1.1-rc.2. The two deltas collide on shared surfaces: upstream replaced the tapIndex injection pipeline with IndexInjection boot seams, unified the image request pipeline, renamed a credentials event the plugin settings page listens on, and split its CI workflows — each colliding with fork-side desktop product code. Staying behind compounds every future sync.

## Decision

Master integrates upstream `b150a551b8` as one merge; released desktop tags stay untouched. The merge bakes in these standing resolutions:

- Web boot adopts upstream's IndexInjection seams (`bootInjections`, the manifest rendered through `globalThis["__DSH_BOOT__"]`). The desktop shell keeps its three integration points — the ui-renderer title-bar wrap, the web-app patch layer's product rows, and the Electron shell — and injects no custom transport.
- The unified image pipeline supersedes the fork's `selectModel` image admission check: text-only or note-policy targets stay selectable because `projectImagesForTextModel` projects images as text notes. The fork keeps its describe-image settings card and `packages/vision/tool-describe-image`; aligning them with canonical encoding and `read_image` scale semantics is deferred follow-up work.
- Credentials keep the boot-time flat-document migration; the plugin settings page listens on the renamed `credentials/reference-updated` event for both the describe-image and web-search cards.
- Every package.json keeps the fork's 1.0.x desktop version line while taking upstream dependency and script fields; `.github/workflows/issue-lifecycle.yml` stays deleted, and fork lanes (`fork-ci.yml`, `desktop.yml`) coexist with upstream's split workflows.

## Alternatives considered

**Rebase the fork commits onto upstream instead of merging.** Linear history reads cleaner, but the desktop line is released: `desktop-v1.0.x` tags and the replay lanes built on them would point at rewritten commits. The merge keeps released history immutable.

**Defer the sync until upstream's first stable tag.** Less cadence noise, but every skipped rc compounds the conflict surface, and rc.2 already changed model-visible image behavior the desktop product shares.

**Drop the describe-image card now instead of deferring alignment.** Following upstream's removal would delete a shipped desktop feature inside a sync commit; keeping it preserves product behavior and confines the remaining divergence to one tracked follow-up.

## Consequences

Session and storage formats are unchanged (`SESSION_FORMAT_VERSION` stays 0), so existing user data needs no migration except the credentials document, which upgrades itself at boot under the writer lock. Future syncs start from this merge, so the fork's delta against upstream is again one integrate commit plus the desktop product line. Tagging desktop-v1.0.7 requires full gates green (build, typecheck, test, snapshot, doc-sync, hygiene) plus desktop regression — credentials migration smoke on a copy of real user data, installed-plugin load checks, and a packaged-app smoke run. The describe-image alignment follow-up owns the remaining divergence between the fork's vision tooling and upstream's canonical image encoding.
