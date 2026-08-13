# Agent Note: Built-in community plugins and profile-scoped controls

Status: implemented

English | [中文](2026-08-14-built-in-community-plugins-and-controls.zh.md)

## Problem

The shipped Web profile contained only the repository-owned base and Web bundles. Users who wanted generative UI, selection annotations, or the community Web UI collection had to discover and install each package themselves, while this distribution intended those three products to be part of its default experience. Settings exposed configuration and a read-only Loader inventory but had no narrow control surface for disabling a distribution-owned product without editing YAML.

A general Loader mutation endpoint would make every installed row remotely addressable, conflate deployment policy with inventory, and inherit teardown behavior from third-party plugins. Live disable/re-enable is not safe as a universal promise: a plugin may register routes, tools, or DOM resources without returning lifecycle disposers, so reactivation can collide with registrations left by the first activation.

## Decision

The `web` profile template orders five bundles: `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@omdsh-dev/dsh-genui`, `@omdsh-dev/dsh-annotation`, and `@linxin666/dsh-web-ui-all`. The two Git packages are pinned to exact commits and the npm aggregate is pinned to `0.1.2`; the lockfile is the source acquisition record. The `dsh-web-app` bundle also declares the aggregate's nine entry packages and the whale-song skin package as direct dependencies pinned to the same `0.1.2`: pnpm's isolated layout does not place nested dependencies on the bundle package's own `node_modules`, and the profile module fallback only mirrors packages resolvable from each closure anchor, so only direct declarations make those entry rows resolvable from a profile directory. The exact former base-plus-Web tuple is installation-owned and migrates to the five-bundle template, while any customized bundle list remains user-owned. This uses the existing profile bundle mechanism and does not restore the removed repository-Plugin path.

The dsh-web-ui 0.1.2 skin center assumes a `skins/` directory in its checkout layout (`packages/skins/<id>`), which no bundled deployment provides, so both try-on and apply fail with ENOENT; its 0.1.2 aggregate also ships no skin rows in the bundle layer (`skin.json`'s `bundleWired: true` contradicts the npm publish), so even a restart would never mount the managed rows. This distribution bridges the upstream gap in four places: a `patchedDependencies` patch to `@linxin666/dsh-client-ui-skin-center` makes it walk ancestor directories for `skins/` when the original location is absent; the same patch makes the managed section always insert the active skin's row and, after a successful apply, reconciles the running Loader tree live (mount the active skin row, disable the others) — packaged Electron cannot provide Cordis HMR's loader internals (`node-addon-require-builtin` fails under Electron) and the desktop disables the patch watcher, so the live reconcile is the only path that makes apply take effect immediately; `scripts/link-community-skins.mjs` links the installed skin packages into the workspace-root `node_modules/skins/<id>` at postinstall time (source launches); and desktop packaging stages the same set into `skins-extras`, shipped by `extraResources` to `app/node_modules/skins` (the packaged app). whale-song is published but missing from the aggregate's dependency list while the 0.1.2 client registry already lists it, so declaring that package directly makes all seven skin-center cards usable.

The Web bundle declares three logical controls: one Loader row for GenUI, one for Annotation, and nine rows moved together as dsh-web-ui. `@deepseek-ai/dsh-host-plugin-control` exposes `list` and `set-enabled` on a loopback-only generic Connection channel. Its deployment-owned catalog is the complete mutation allowlist; profile-local ids must each resolve to exactly one mounted Loader entry. The gateway never accepts an arbitrary inventory id and remains separate from the read-only Typert inventory Remote.

Each mutation writes managed `{id, disabled}` patches to the active profile's `cordis.patch.yml` under `# dsh-plugin-control: <control-id>` comments. File locking and atomic publication serialize concurrent writers and preserve unrelated YAML nodes, comments, and `!!js` expressions. The launcher provides the exact profile patch path as `ctx.profileUserPatchPath` before rows mount, so the Host plugin does not derive a path from ambient home state.

Switches are restart-time settings. The gateway returns the saved desired state but does not mutate the current Loader tree; the next process applies the ordinary profile layer order. This supports third-party plugins without claiming reversible teardown. Home-level patches and command-line overlays retain their later-layer precedence.

`@deepseek-ai/dsh-client-ui-settings-plugin-control` contributes the third `settings.plugins.tab` entry, **Plugin switches**, through the existing slot ledger. It lazily reads state only when selected, renders one accessible switch per logical product with source attribution, never calls the privileged route from a remote browser, and tells the user that a successful change requires restart.

## Alternatives considered

**Copy or fork the three projects into this repository.** Rejected because the requested projects already publish installable profile bundles. Pinning their upstream packages preserves attribution and lets their owners retain implementation and release responsibility.

**Expose enable/disable on every row in Plugin list.** Rejected because inventory does not identify which rows form one product, and an unrestricted mutation endpoint would expand browser authority from three distribution choices to the complete deployment tree.

**Apply Loader updates immediately after writing the patch.** Rejected after the real Web composition demonstrated a valid third-party lifecycle that could disable but not reactivate without a duplicate route. A restart-time rule is deterministic for all profile bundles and avoids partially reloaded products.

**Store settings in a separate JSON file.** Rejected because the profile patch is already the authoritative user-owned layer, participates in dump and HMR semantics, and makes the next boot inspectable without another configuration source.

**Use Typert for mutations.** Rejected because the existing generated inventory namespace is deliberately read-only and transport-neutral. The generic Connection channel already owns trust-scoped browser-to-Host commands without broadening the API graph.

## Consequences

New and installation-owned Web profiles receive all three community products enabled by default. Existing profiles with the exact previously shipped tuple migrate automatically; customized profiles do not gain surprise layers. The source packages and LINUX DO receive visible acknowledgements in both root READMEs, while generated third-party notices carry their licenses.

Settings retains one Plugins navigation row and now has three independently owned tabs. The earlier feature-owned tab decision remains the slot architecture authority; this note extends its concrete roster and adds a separate privileged capability.

The profile-bundle and repository-Plugin notes remain active foundation records. This feature uses ordered bundle dependencies as the single external distribution path and adds no source cache, wrapper format, or second installer.

GenUI and dsh-web-ui can change model-visible prompts and tools, while Annotation adds model-visible content when used. Disabling a product therefore changes the next process's request prefix or tool roster and begins a new KV-cache prefix after restart.

## Testing

Focused Host tests cover catalog validation, loopback registration, aggregate states, serialized atomic YAML writes, cancellation, invalid YAML, unavailable controls, and preservation of unrelated nodes. Browser package tests cover slot lifecycle, localization, response validation, accessibility, remote authority, retry, mutation failure, and late settlements. Profile tests cover the five-bundle template plus exact legacy migration and customized-list preservation. The keyless Web browser replay boots the real five-bundle composition, snapshots the third tab, writes both switch states through the real loopback route, confirms the running plugin remains mounted, and verifies the managed profile patches.
