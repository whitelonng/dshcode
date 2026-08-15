# Agent Note: pnpm delegation, SRI integrity, and the plugin discovery layer

Status: implemented

English | [中文](2026-08-15-pnpm-delegation-and-plugin-discovery.zh.md)

## Problem

The desktop installer's self-rolled registry client kept re-implementing what a package manager already owns: dependency trees (only bundle-style packages got one), build scripts (never run), git monorepo subdirectories (`#…&path:` — unsupported), and tarball integrity (unverified beyond HTTPS). The plugin list offered no way to discover plugins — the user had to know a package name or repository. And the two install surfaces diverged: the desktop wrote the flat fallback, while the CLI (`dsh plugin add`) wrote the profile workspace, so the same plugin existed in two states.

## Decision

**System-pnpm delegation (mode A, `src/pnpm.ts`).** The gateway probes `pnpm --version` once per process (under an augmented PATH whose candidate directories let pnpm's `env node` shebang resolve inside GUI processes) and memoizes the result. When pnpm is available, `install`/`update`/`uninstall` forward to `pnpm add`/`remove` in the web profile workspace (`dirname(profilePatchPath)`, which `initProfile` already made a pnpm workspace with `nodeLinker: hoisted`) — registry resolution, transitive dependencies, lockfile integrity, git monorepo selectors, and build scripts all come free. pnpm ≥10's refused build scripts (`ERR_PNPM_IGNORED_BUILDS`) leave `allowBuilds` placeholders; `approvePendingBuilds` fills them and the command retries once. A re-install of an already-present dependency (pnpm answers "Already up to date" without adding a key) reports the existing dependency's name — matched by the recorded spec (pnpm stores git specs verbatim) or the parsed npm name. The installed form decides the mount point: a `dsh.bundle` package joins `dsh.profile.bundles` (no installer row; `setBundleLayerEnabled`/`readBundleLayerEnabled` write bundle-marker override rows for its patch ids so the switch still works), a plain package gets a managed insert row. Machines without pnpm keep the self-rolled paths byte-for-byte. `writeState` now ensures the home directory before locking, since the delegated path no longer creates the module fallback.

**SRI integrity (`src/registry.ts`).** The tarball bytes are hashed (sha256/384/512) while streaming into the extractor, and a declared `dist.integrity` must match at least one supported token — mismatches and unsupported algorithm sets fail loud; the pinned integrity is recorded on the `plugins.json` record.

**Discovery layer (`src/sources.ts`, `src/catalog.ts`).** `$DSH_HOME/plugin-sources/` holds three planes: `sources.yml` (index source set with `official|community|untrusted` trust levels; the dsh-external hub catalog is the seeded default), `lock.yml` (TOFU: every install pins its resolved reference), and `cache/<source>/entries.json` (enumeration snapshots, TTL 6h, ETag 304 conditional refresh, local `file://` channel for private hubs). Gateway endpoints `search`/`sources`/`add-source`/`remove-source` expose it to the browser bridge, and four model-facing tools — `plugin_search`/`plugin_install`/`plugin_uninstall`/`plugin_status` — wrap the same gateway state, catalogued in `docs/tool-catalog.md` through the boot-manifest entry in `scripts/gen-tool-catalog.ts`. A browse UI shipped with the layer and was later removed by product decision (users find plugins on GitHub/npm themselves and paste them into the install box); the endpoints and tools remain the search surface.

## Alternatives considered

**Built-in pnpm binary (mode B).** Bundling the pnpm standalone executable into the packaged app removes the environment assumption entirely. Deferred: mode A keeps the self-rolled fallback for machines without pnpm, and the packaged-app matrix cost (per-platform binaries) was not worth taking before mode A proves out in the field.

**Discovery as a separate package.** The storage and enumeration could live beside the console plugin instead of the gateway. Kept in `plugin-installer` because the model tools and the desktop shell share its state and the desktop ships the gateway everywhere.

**Verifying integrity only when the registry declares sha512.** Rejected: sha256/384 declarations exist in the wild, and a declaration with no supported algorithm must fail loud rather than silently skip (pinning without a verifiable algorithm is false confidence).

## Consequences

- The three original failure classes (aggregator dependency trees, monorepo git installs, build-script refusal) disappear on any machine with pnpm — they are pnpm's native capabilities now. Machines without pnpm keep the exact fallback behavior, including the improved git diagnostics.
- Install state has one extra authority pair (profile `package.json` bundles + insert rows) but `plugins.json` remains the TOFU record with the pinned integrity; `enabled` stays derived, never stored.
- The discovery layer is opt-in network surface: the seeded hub catalog is fetched on first search and cached 6h per source; an unreachable source degrades to a skipped enumeration, never a failed search.
- The tool catalog golden now includes the four `plugin_*` tools (and the pre-existing `describe_image` harvest drift is folded into the updated expected list).

## Related

- [Bundle-style plugin installs and git identity diagnostics](../../implemented/architecture/2026-08-15-bundle-style-plugin-installs.md) owns the bundle-row formats this change extends with the layer-override rows; [user plugin install and update](../../implemented/architecture/2026-08-14-user-plugin-install-and-update.md) owns the gateway this change delegates from.
