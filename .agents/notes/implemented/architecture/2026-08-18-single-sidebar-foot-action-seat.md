# Agent Note: One sidebar foot action seat — removing the dedicated remote seat

Status: implemented

English | [中文](2026-08-18-single-sidebar-foot-action-seat.zh.md)

> Scope: why `ui-sidebar` no longer declares the dedicated `'sidebar.remote'` foot seat and keeps only the generic `'sidebar.footer.action'` list beside Settings. Follows the [slot system standard](2026-07-22-slot-type-chain-implementation.md); reverses the seat half of [Web UI slot seats and the dsh-web-ui compat shim](2026-08-14-web-ui-slot-seats-and-compat-shim.md).

## Problem

Installing the community dsh-web-ui family (`@linxin666/dsh-web-ui-all`) made the mobile-remote entry appear twice above the Settings trigger: the shell declared both `'sidebar.remote'` (added for that plugin's pairing trigger) and the generic `'sidebar.footer.action'`, and the published plugin registers its entry into both seats — a fallback pattern written for shells that declare only one of them. Shells built before the second seat existed render the plugin once, which is why a terminal run on an older build looked correct while the desktop app (a newer shell with both seats) showed two rows. The duplication is user-visible for anyone installing the family on a two-seat shell, and nothing inside the shell can stop a third-party plugin from registering into two seats it declares.

## Decision

Remove the `'sidebar.remote'` seat from `ui-sidebar`: the SlotMap entry and owner props in `contract/slots.ts`, the `children` declaration and type export in `src/client/index.ts`, the dedicated foot row in `SidebarRoot.tsx`, its `remoteArea` CSS rules, and the regenerated model-facing client slot catalog. The foot keeps `'sidebar.footer.action'` beside Settings — the seat the published plugin already falls back to when `'sidebar.remote'` is not declared — so every published plugin version renders exactly once on both old and new shells. The removal is shell-side on purpose: the plugin is a third-party npm artifact this repository cannot ship changes to, while the slot surface is shell-authoritative.

## Alternatives considered

**Fix the plugin's exclusivity check upstream.** Checking `ctx.slots.spec('sidebar.remote')` before registering the fallback is the correct long-term shape, but it lives in the upstream repository this distribution cannot publish to, and waiting leaves every current user with the duplicate until the next plugin release. The seat removal is compatible with that upstream fix: once it ships, the plugin's fallback simply registers once into `'sidebar.footer.action'`.

**Add cross-seat dedupe to the slot system.** Rejected: registration ids are per-seat, and cross-seat identity would let the slot core decide who may render what — while one plugin legitimately registering several entries into different seats is a valid pattern.

**Keep the seat and document that registrants must be exclusive.** Rejected: prose cannot enforce anything on third-party bundles.

## Consequences

- SlotMap loses `'sidebar.remote'`; third-party registrations targeting it wait forever and must use `'sidebar.footer.action'`. The published dsh-web-ui family already has that fallback, so the mobile remote entry renders once, directly above Settings, in the expanded sidebar and the rail alike.
- The empty foot row disappears from the DOM for every deployment; it rendered nothing while unoccupied, so deployments without the plugin see no visual change.
- The model-facing client slot catalog (`cordis_inspect what:"client"`) regenerates without the seat.
- The [2026-08-14 seat note](2026-08-14-web-ui-slot-seats-and-compat-shim.md) is updated in place: the shell now declares one community seat, `'conversation.input.selector.context'`.

## Testing

- `ui-sidebar` apply spec asserts the children declaration and teardown without the remote seat; the sidebar-root spec drops the remote-seat fixtures and keeps the footer action seat's wide-flag assertions in wide and collapsed states.
- Three `sidebar-snapshot` snapshots regenerate without the `data-slot="sidebar.remote"` row.
- The client slot catalog is regenerated (`gen-client-catalog`) and verified (`verify-client-catalog`); its consumers (`cordis-client-runner`, `tool-cordis`) pass (119 tests).
- `pnpm run test:gui` passes (300 files, 4134 tests) and the repo-wide typecheck is clean.

## Related

- [Web UI slot seats and the dsh-web-ui compat shim](2026-08-14-web-ui-slot-seats-and-compat-shim.md) — originally declared the seat this change removes.
- [Built-in webui trim, install-time product conflict disables, archive search and multi-select](2026-08-15-webui-suite-trim-and-archive-selection.md) — the earlier fix for the other duplicate-entry source (bundled suite plus user install).
- [Slot system standard: type chain implementation](2026-07-22-slot-type-chain-implementation.md)
