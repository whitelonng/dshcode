# Agent Note: Built-in webui trim, install-time product conflict disables, archive search and multi-select

Status: implemented

English | [中文](2026-08-15-webui-suite-trim-and-archive-selection.zh.md)

## Problem

The shipped desktop carried a nine-package webui suite (`packages/bundle/web-app` preset product `web-ui` and its `@linxin666/*` dependencies). The suite's features duplicated sidebar entries the user could also obtain by installing `dsh-web-ui` themselves — the bottom-left corner showed two rows of the same functions with different entry ids, and the installer's dedupe (skip insert rows whose id the patch already owns) cannot detect same-feature-different-id duplicates. Redundant features kept shipping in every app update. And the archived-sessions settings page had no way to find or act on several conversations at once.

## Decision

**Built-in webui trim (`packages/bundle/web-app`).** The `web-ui` preset product keeps only `pet` (`@linxin666/dsh-pet`) and `ui-skin-center` (`@linxin666/dsh-client-ui-skin-center`, plus its `dsh-client-ui-skin-whale-song` theme which stays in dependencies); the seven other packages are removed from the preset rows and from `package.json` (including `@linxin666/dsh-web-ui-all`). Updates of the suite therefore only carry the skin (and the pet pin stays put) — the redundancy disappears from the shipped closure entirely.

**Install-time conflict disables (`plugin-installer`).** The gateway `Config` gains `disableControlsOnInstall: [{ id, matches }]`; after a successful install or update whose package name contains any `matches` substring (case-insensitive), the gateway flips `disabled: true` on every patch row carrying the `# dsh-plugin-control: <id>` marker (`setControlRowsEnabled` in `patch.ts`, sharing the marker convention with `plugin-control`'s `control-file.ts`). The web profile wires `[{ id: web-ui, matches: ['dsh-web-ui'] }]`, so a user-installed webui suite turns the built-in product off at the next start instead of double-mounting.

**Archive search and multi-select (`dsh-client-ui-settings-archive`).** The section gains a search box (filters by folded title or session id), a per-row selection checkbox with a select-all toggle over the filtered rows, and a bulk toolbar: 恢复所选 runs immediately (restore is non-destructive), 删除所选 requires the existing irreversible-deletion confirmation modal; bulk mutations run sequentially over the selection and refresh the list once.

## Alternatives considered

**Dedupe by rendered label.** Matching sidebar entries by display text would need a label registry across client plugins and still cannot tell intentional same-label entries apart. Rejected: removing the redundant packages from the shipped closure is the honest fix.

**Disable via the plugin-control channel.** The host RPC surface is handle/intercept only (no in-process call), so the installer cannot invoke plugin-control's `set-enabled`. The patch-level rule above keeps both plugins decoupled and works without a new service seam.

**Bulk archive endpoints.** A host-side batch restore/delete would save round-trips but touches the persistence API; sequential single-row calls reuse the exact same validated paths the single-row actions already use.

## Consequences

- The shipped app mounts only pet + skin-center from the webui suite; the duplicated bottom-left entries are gone from the closure, and future suite updates only bump the skin.
- User webui installs now flip the built-in product off automatically; the user can still re-enable the built-in product through its preset switch if they want both.
- The archive page supports search and bulk restore/delete with the same confirmation discipline as single-row deletion.
- `plugin-control`'s `list()` treats rows whose entries are all disabled as `disabled`, so the disabled built-in product renders consistently in the merged plugin list.

## Related

- [pnpm delegation, SRI integrity, and the plugin discovery layer](2026-08-15-pnpm-delegation-and-plugin-discovery.md) owns the gateway configuration this change extends with `disableControlsOnInstall`; [merged plugin list tab](2026-08-15-merged-plugin-list-tab.md) owns the preset-product rows the conflict rule disables.
