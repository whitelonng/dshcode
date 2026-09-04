# Agent Note: Merged plugin list tab with per-entry enablement

Status: implemented

English | [中文](2026-08-15-merged-plugin-list-tab.zh.md)

## Problem

The Plugins settings section carried three parallel tabs — install/update, plugin switches, and the Loader inventory — and the switches page and the list page duplicated the same enablement information. Installed user plugins had no enablement switch at all, built-in entries were read-only, and a stalled npm registry left the install button in a permanent installing state.

## Decision

`@deepseek-ai/dsh-client-ui-settings-plugin-installer` now owns the single merged **Plugin list** tab (slot id `plugins`, order 10). The user section renders the install box, the deployment's preset products (plugin-control catalog rows with switches and source links), then the installed user-plugin rows — each with its saved enablement switch, version, update availability, update, and confirmed uninstall. The built-in Loader entries stay below, collapsed by default, searchable, and read-only (no switches). The `controls` tab and the separate read-only inventory tab are gone; the two browser packages (`ui-settings-plugin-inventory`, `ui-settings-plugin-control`) are deleted while their Host gateways (`plugin-inventory`, `plugin-control`) remain mounted for the profile.

Enablement persistence has exactly two owners:

- `plugin-installer` `set-enabled { id, enabled }` rewrites the plugin's managed patch item with a `disabled` key; rows it creates keep the `dsh-plugin-installer:` marker and ride an `insert` item, because the user patch layer applies bare rows as overrides of existing entries and would silently skip a row whose id is not mounted yet (the original bare-row format never mounted anything — the fix for installs not taking effect).
- `plugin-control` `set-enabled` writes (or rewrites) one `insert` item marked `dsh-plugin-control: <id>` carrying every governed entry's id and module specifier; the catalog gained per-entry `packages`, so enabling a never-mounted product now creates its rows instead of failing as unavailable. Absent rows project as `disabled`, ambiguous ids remain `unavailable`.

The saved state's single source of truth is the patch layer, not an in-memory desired map: `plugin-installer`'s `list` reads the managed item on every call (the browser toggle shows `plugin.enabled` directly, not an inventory join that mismatched generated entry ids), and `plugin-control` overlays its `desired` map for same-process feedback. The installer's durable `plugins.json` stays format-stable — `enabled` is derived per response and never stored.

Installs also gained a `status` endpoint (`idle`, or `fetch`/`download`/`extract`/`write` with an optional download percent) that the browser polls while a mutation runs and renders as a progress bar; registry requests carry hard timeouts (30 s metadata, 60 s tarballs, honoring the caller's abort signal), so a stalled network surfaces as a typed error instead of an endless installing state. Install specs are validated before any request (npm name pattern or one git URL), rejecting pasted prose with a readable error.

## Alternatives considered

**Keep the three tabs and only merge the list with the switches.** Rejected because user plugins would still appear in two places and the install/update tab would remain a third, overlapping surface.

**Make every built-in entry toggleable through the inventory Remote.** Initially shipped, then reverted on product feedback: built-ins must stay read-only, so `plugin-inventory` returned to its read-only projection and the per-entry mutation endpoint was removed.

**Join saved enablement from the inventory by entry id.** Rejected after the Loader entry ids turned out to carry generated prefixes; the installer's own `list` reads the managed patch item directly, which is authoritative and stable across boots.

**Store `enabled` in the installer state file.** Rejected because enablement is derived from the patch row; persisting it twice would create a staleness risk with no reader.

## Consequences

The Plugins section now has two tabs: configuration cards and the merged plugin list. Preset products and user plugins are toggleable and the latter additionally update and uninstall; built-in Loader entries are read-only. Switch persistence takes effect at the next restart, matching the pre-existing plugin-control contract. The [feature-owned tabs note](../../archived/architecture/2026-08-11-plugin-settings-tabs.md) keeps the slot-ledger mechanism but its tab inventory is superseded here, as is the browser-switches half of the [community products and profile controls note](2026-08-14-built-in-community-plugins-and-controls.md) — the `plugin-control` Host row remains for deployments that configure a catalog, and its catalog now creates rows for never-mounted products.
