# Agent Note: Portable plugin failsafe: distilling DSH's plugin-conflict and boot-error recovery into one reusable plugin

Status: proposed

English | [中文](2026-08-18-portable-plugin-failsafe.zh.md)

## Problem

DSH handles two plugin-lifecycle hazards automatically — a user install that conflicts with a built-in product, and a plugin that breaks startup — and the mechanism is spread across three surfaces:

- **Conflict handling at install/update time** lives in `packages/host/plugin-installer`: `disableControlsOnInstall` rules disable a built-in product's patch rows after a matching install or update, and bundle-row merging skips insert rows whose ids the profile patch already claims, so two suites never double-mount.
- **Boot-error detection, attribution, and recovery** lives in the desktop shell (`apps/desktop/src/recovery.ts`, `boot-marker.ts`, `main.ts`): a boot lifecycle marker, a 60 s watchdog, deterministic attribution, a bounded per-plugin failure ring, and a recovery dialog ladder (disable and relaunch / safe mode / exit).
- **The structural substrate** is the profile patch layer with marker-owned managed rows (`packages/host/plugin-installer/src/patch.ts` and `bundle.ts`), the fail-loud activation audit in `packages/boot/app-boot`, and safe mode as `skipUserPatches` in `apps/cli/src/profile-boot.ts`.

A third-party project that wants the same safety net must reverse-engineer it from three places, and the shell pieces do not travel. This note distills the mechanism into principles and proposes packaging it as one installable, host-agnostic plugin.

## Proposal

### The distilled mechanism

**Principle 1 — conflicts are resolved structurally, at write time.** One patch layer owns "what mounts and whether": every entry has a stable id, and the layer's only two row semantics are id-targeted overrides (last write wins) and `insert` lists (add new entries). Every mutation carries an ownership marker comment (`dsh-plugin-installer: <id>`, `dsh-plugin-control: <id>`, `dsh-plugin-bundle: <id>`), so rows are auditable, removable, and re-flippable by their owner. Double-mounting is prevented when rows are written, not arbitrated when entries boot: bundle merges skip insert rows whose ids are already claimed, and configured conflict rules (`disableControlsOnInstall: [{ id: 'web-ui', matches: ['dsh-web-ui'] }]` in the web profile) disable a duplicated built-in product's rows. Every automatic conflict action is therefore reversible (flip the same rows back) and attributable (the marker names the writer).

**Principle 2 — errors run a bounded detect → attribute → act → record loop.** Detection covers the three failure shapes no single mechanism catches: a thrown load or activation failure (the Loader's activation audit names every failed entry and fails loud); a boot hang (watchdog timeout); a hard crash or main-thread hang (the boot marker: a `started` write without a following `ok`, plus a `bootAttempts` streak). Attribution is deterministic and conservative: a load failure is blamed on the installed plugins whose names appear in the failure text, a hang on plugins installed or updated after the last successful boot, and anything else gets no blame list — a guess is worse than none. A conflict the write-time rules could not prevent becomes this loop's input: it fails startup like any other plugin error and is resolved by the same ladder — there is no separate conflict-recovery path. The action ladder steps down in confidence: attributable → record and offer "disable the blamed plugins and relaunch" (the same managed-row writer the user toggle uses); unattributable → offer safe mode (skip the user patch layers without parsing them — a broken patch file is a recovery case, not a boot blocker); safe mode still failing → built-in or installation problem, retry or exit, never disable user plugins; three consecutive failures → safe mode becomes the default choice. Recording is bounded by construction: a per-plugin ring (one record per plugin, newest first), hard caps (8 records, 2 KB message, 16 KB stack, 100 KB file), 90-day retention swept at read and write, atomic writes, cleared on uninstall and on successful re-enable. The repair surface is the failure badge, copy-error, and "let the agent fix" — a conversation whose workspace is the plugin install root.

**Principle 3 — one authority, one writer, and diagnostics that never block recovery.** Install state, failure records, and patch rows all mutate through one serialized, file-locked, atomic-write gateway; recovery reuses the exact writer the settings toggle uses, so no format has a second implementation. Misconfiguration fails loud at boot (a present patch file that cannot apply is an error, never a skip), while diagnostics degrade per path (a corrupt failure ring must never block startup recovery; reads fail loud for repair). The real boot is the only authoritative conflict and failure detector — no pre-flight heuristic is trusted.

### The portable plugin

Package the mechanism as one configurable plugin (working name `dsh-plugin-failsafe`) whose host differences converge into five adapter ports, so a target project integrates it by implementing the ports, not by forking the mechanism.

- `PluginRegistry` — the installed plugins (id, name, version, installPath, installedAt): attribution input and repair context.
- `EnableWriter` — persist one plugin's next-start enablement (DSH: the managed patch row's `disabled` flag); the host's own user toggle must use the same port.
- `BootControl` — boot marker read/write, the watchdog wrapper, relaunch, and the safe-mode switch (DSH: `skipUserPatches`).
- `Reporter` — the recovery dialog, failure badge, and log sink (the desktop dialog becomes one implementation).
- `Store` — home-directory file primitives with atomic writes (bounded failure ring, marker).

Config surface, all defaulted to the desktop behavior: `bootTimeoutMs` (60 s), `consecutiveFailureThreshold` (3), ring caps and retention, `conflictRules: [{ id, matches }]`, and optional attribution hooks replacing the name-in-text and installed-after-last-ok defaults.

Behavior contract — when each step runs:

| Lifecycle point | Action |
| --- | --- |
| Launch begin | Write the `started` marker, read safe mode, sweep expired failure records |
| Boot | Run the host boot under the watchdog; on success write `ok` and clear the failure records of plugins that are enabled again |
| Boot failure | Attribute → record → reporter ladder (disable + relaunch / safe mode / exit; the safe-mode-failed branch) |
| Runtime | Host fail-loud hook → record an attributable late rejection |
| Install/update success | Apply conflict rules → disable a duplicated built-in product |
| Uninstall / re-enable | Clear that plugin's failure records |

Portability checklist for a target host — the minimum assumptions: a durable per-plugin enable/disable that applies at the next start; a plugin id plus install time; one unambiguous "boot is ok" point and a fail-loud exit; a restart channel. Hot-reload hosts that could quiesce and retry in-process are a deferred extension — see the rejected same-process alternative below.

Delivery form: for DSH the plugin installs as an ordinary plugin (plain or bundle) with adapter implementations replacing the desktop-specific pieces; for other projects the same core ships with a host-adapter guide, and the five ports are the only host-specific code.

## Alternatives considered

- **Same-process fault tolerance (mount the failed entry as disabled and keep running).** Rejected in DSH because it changes the vendored Loader's transactional rollback and tolerates half-registered services from a plugin that threw mid-`apply`; disable-then-relaunch reuses the existing restart channel. The portable plugin keeps the same "applies at next start" boundary.
- **Agent-driven install-time conflict pre-checks.** Rejected: a pre-install reading of plugin code is a non-authoritative signal; the real boot is the authoritative conflict detector, and the recovery flow already delivers its verdict to the user.
- **An append-only error log.** Rejected: unbounded growth needs a background janitor; the ring is bounded at every write and cleaned by lifecycle events instead.
- **Fully automatic disable with no dialog.** Rejected: the user owns the code-execution decision and needs visibility, and safe mode is a choice attribution can never select. A host may still opt into an `autoDisable` policy, but it is not the default.
- **Copying the mechanism per host.** Rejected: the shell, installer gateway, and boot glue are three coupled surfaces; five adapters are the minimum host-specific surface and keep the invariants in one implementation.

## Acceptance criteria

- On DSH, the plugin reproduces the current desktop behavior — conflict-rule disable, marker/watchdog/attribution, failure ring, recovery ladder, safe mode, clear-on-success and clear-on-uninstall — with the shell dialog as one `Reporter` implementation.
- At least one non-DSH fixture host exercises the five ports through the full loop: install conflict → auto-disable; forced load failure → attribute → disable → relaunch; hang → hang suspects; unattributable → safe mode; successful re-enable → records cleared.
- Every tunable has a documented default matching the DSH behavior; no config is required for the default loop.
- The bounded-ring and atomic-write invariants hold under the fixture host (caps, retention, malformed-file behavior).
- README plus a host-adapter guide document the five ports, the behavior contract, and the portability checklist.

## Risks

- Attribution remains heuristic: simultaneous installs can over-disable. Safe mode is the documented fallback — the same trade-off DSH accepted.
- Hard crashes and main-thread hangs leave no record; only the marker covers them. A host that cannot write a marker at launch loses that branch.
- Hosts without a next-start apply boundary (pure hot-reload systems) fit poorly; the plugin targets restart-based hosts first and documents the in-process extension as deferred.
- Safe mode skips the user layer wholesale, which can mask a built-in defect; the "safe mode still failed → installation problem" branch keeps the two causes distinguishable.

## Related

- [User plugin install and update](../../implemented/architecture/2026-08-14-user-plugin-install-and-update.md) owns the install pipeline, managed patch rows, and the conflict-rule write path this proposal generalizes.
- [Desktop plugin boot-failure recovery](../../implemented/architecture/2026-08-15-desktop-plugin-boot-recovery.md) owns the marker/watchdog/attribution/recovery ladder this proposal distills.
