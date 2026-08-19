# Agent Note: Web UI slot seats and the dsh-web-ui compat shim

Status: implemented

English | [中文](2026-08-14-web-ui-slot-seats-and-compat-shim.zh.md)

> Scope: how the community dsh-web-ui feature plugins (task board, SSH panel, right panel, git graph, whale pet, mobile remote, live token stats) mount their GUI surfaces against this shell, and why the shell declared a slot seat plus a live-token projection read. Extends [Built-in community plugins and profile-scoped controls](2026-08-14-built-in-community-plugins-and-controls.md) (same distribution, this note covers the GUI mounting side); follows the [slot system standard](2026-07-22-slot-type-chain-implementation.md).

## Problem

The built-in `@linxin666/dsh-web-ui-all@0.1.2` plugins loaded server-side and their client bundles served, but none of the seven feature surfaces appeared in the GUI: the plugins mount at two kinds of points this shell did not provide. Task board, SSH, and the AionUi-style right panel wait on legacy DOM hooks (`[data-pane="sidebar"]`, `[data-pane="conversation"]`, `[data-dsh-frame]`) through MutationObservers, while git graph, the whale pet, and mobile remote register into slot seats (`conversation.input.selector.context` for the first two; the mobile remote plugin falls back to `sidebar.footer.action`) that no entry declared. Live token stats registered a host projection (`liveTokenUsage`) but the conversation stats line never read it. Each missing point fails silently — an observer or `slots.inject` callback waits forever — so the deployment shows no error.

A second, subtler gap surfaced once the DOM hooks were stamped: the shell's slot outlets wrap every slot's content in a `display: contents` div (`[data-slot="sidebar"]` etc.). The family plugins resolve the pane root as `[data-pane=…]`'s first element child and expect that child's direct children to include the shell's buttons; with the outlet wrapper sitting between the column and the pane root, that assumption never held, so task board and SSH stayed silent even with the attributes present.

## Decision

The upstream family ships a dedicated shim, `@linxin666/dsh-web-ui-compat`, that stamps the legacy `data-pane` / `data-dsh-frame` attributes onto the shell and re-stamps them on DOM mutation. This distribution builds that package locally from the published source (BSD-3-Clause, attribution retained), installs it into the profile's shared module fallback, and adds its `ui-web-ui-compat` row to the `web` profile user patch layer. The shim only ever writes attributes and never disturbs React reconciliation.

Because bare plugin rows import from the packaged app's own `node_modules` (the Loader resolves from its own location, not the profile directory), the shim must also ship inside the desktop app: `prepare-package.mjs` stages the profile-installed package into `compat-extras` (mirroring the skins-extras mechanism) and `electron-builder.yml` ships it through `extraResources` to `app/node_modules/@linxin666/dsh-web-ui-compat`.

The shim's stamping is wrapper-first: it stamps `data-pane` onto the slot-outlet wrapper (`[data-slot="sidebar"|"conversation"|"details"]`) when one exists — the wrapper is then the first `[data-pane]` match in document order and its first element child IS the pane root, the exact DOM shape the plugins' mount code assumes — and falls back to the css-module column (`[class*="sidebarCol"]` / `centerCol` / `detailsCol`) on wrapper-less shells. `data-dsh-frame` goes on the frame grid (the sidebar column's parent) for the AionUi-style panel.

One shell-owned slot seat closes the slot-based gap, following the slot system standard (children = declaration + authorization, one `register` API):

- `ui-conversation` declares `'conversation.input.selector.context'` (`list`, `session-maybe`) and renders it in every conversation phase above the composer card (hidden via `:empty` while unoccupied, so the empty seat costs no layout). The git branch chip and the pet summon button dock there; session-maybe matches the plugins' cold-start-through-active contract.

`ui-sidebar` also declared a dedicated `'sidebar.remote'` foot seat for the mobile remote pairing trigger at the same time; that seat was later removed so the published plugin renders exactly once through its `sidebar.footer.action` fallback — see [One sidebar foot action seat](2026-08-18-single-sidebar-foot-action-seat.md).

Live token stats reuse the existing projection channel end to end: the plugin's host half already registers the `liveTokenUsage` session projection (buckets + `estimated` + `tokensPerSecond`). `token-meter` owns the `LiveTokenUsageProjection` type and the `SessionProjectionMap` entry, and the conversation `StatsLine` reads `useProjection('liveTokenUsage')` — while the session is running, a leading group shows the live throughput; it disappears once the run settles and the settled decode-average group takes over.

## Alternatives considered

**Port only the DOM shim and drop the slot features.** Rejected because three of the seven products (git graph, pet, mobile remote) would stay invisible.

**Re-register the family plugins against existing seats** (`sidebar.footer.action`, a new input-dock row) by rebuilding the whole family from source. Rejected: the published 0.1.2 bundles already target those seats (and the mobile remote plugin has since gained its own `sidebar.footer.action` fallback), so porting the seats keeps the installed npm artifacts working without owning a second build pipeline.

**Declare the seats from a separate compat plugin.** Rejected because slot declaration is shell-authoritative (children = claiming), and a third-party package declaring shell slots would couple the shell's render authority to a removable plugin.

## Consequences

The shipped shell now declares one additional session-maybe seat (plus the generic `sidebar.footer.action` foot list the mobile remote plugin falls back to); unoccupied seats render nothing, so deployments without the community plugins see no layout change. The `liveTokenUsage` projection key is part of the standard projection map and its value arrives through the ordinary projection push channel — absent (older host or disabled plugin), the stats line simply omits the live group.

The compat shim is an upstream-published artifact, installed beside the other family packages in the profile fallback and shipped inside the desktop app through the packaging staging step; upstream updates replace it without repository changes. Its plugin row is a user-patch insert, applied after bundle layers, and can be removed independently. The repository-side footprint is the packaging stage (one function + one `extraResources` entry), not a vendored copy of the shim.

## Testing

ui-sidebar and ui-conversation apply specs assert the new children declarations and teardown; the sidebar-root spec asserts the footer action seat receives the wide flag in wide and collapsed states; the skeleton spec asserts the selector context row renders in hero and active phases; the chat-stats spec covers the live group's leading position, its disappearance after settle, and the missing-throughput case. The package suites and the client-face typecheck pass. A separate `web` profile process verified the assembled boot manifest serves the compat entry and the new bundles, and that the `liveTokenUsage` projection still registers.
