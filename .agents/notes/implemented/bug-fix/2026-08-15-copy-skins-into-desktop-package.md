# Agent Note: Copy skin packages into the desktop stage

Status: implemented

English | [中文](2026-08-15-copy-skins-into-desktop-package.zh.md)

## Problem

`prepare-package`'s `assembleSkinsExtras` symlinked each staged skin package from `$TMPDIR/dshcode-desktop-<id>/node_modules/.pnpm/...` into `skins-extras`, and electron-builder shipped that tree into the app bundle as `node_modules/skins`. The packaged app therefore depended on the temporary staging directory surviving: the OS may delete `$TMPDIR` contents at any time, and every repackage rewrites the stage, so the shipped links dangle after cleanup or whenever the stage's package set changes. A `dsh-skin`-managed profile link pointed at a `skins/blue-fantasy` entry a later repackage no longer produced, failing that row at boot.

## Decision

`assembleSkinsExtras` copies each skin package directory into `skins-extras` instead of symlinking it. The app bundle is self-contained: shipped skins survive temp-directory cleanup and stop depending on the stage layout. The stage directory is removed and recreated at the start of every packaging run, so the copy target is replaced wholesale rather than reconciled.

## Alternatives considered

**Ship the whole staged `.pnpm` store.** Rejected because it multiplies bundle size and ships dev-time layout details for a handful of small packages.

**Keep symlinks and recreate them inside the app bundle at first launch.** Rejected because it makes launch mutate the installed app, and the same package-set drift that breaks the link would make recreation fail or point at the wrong version.

## Consequences

Repackaged desktop builds carry real skin directories. Skins whose packages the deploy closure no longer includes are still absent from the bundle — rows referencing them fail loudly at boot as before — but every shipped skin now resolves independently of the temporary directory. The packaging change is exercised by the next desktop package run; the skin-center resolution contract (a `skins/` directory beside an ancestor `node_modules`) is unchanged.

## Related

[Built-in community plugins and profile-scoped controls](../../implemented/architecture/2026-08-14-built-in-community-plugins-and-controls.md) owns the deployment-owned skins tree and the patched skin-center resolution this packaging step assembles.
