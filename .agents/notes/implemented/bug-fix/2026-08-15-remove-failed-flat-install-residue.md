# Agent Note: Remove failed flat-fallback install residue

Status: implemented

English | [中文](2026-08-15-remove-failed-flat-install-residue.zh.md)

## Problem

`installNpmPackage` removed and recreated the target directory before downloading the tarball, then extracted into it. Any failure after that point — an aborted download, a tar error, an integrity mismatch — left an empty or half-written directory in the flat module fallback. Node's resolver reports "Cannot find package X" for a directory that exists without a manifest and stops walking parents there, so the residue both broke every boot that imports the package and hid the fact that the install never completed. A cancelled `dsh-web-ui-all` dependency walk left empty `ssh2` and `cloudflared` directories that made the `dsh-ssh` and `dsh-remote-web-ui` rows fail at boot with exactly this shape.

## Decision

`installNpmPackage` wraps the extraction and integrity verification so any failure removes the target directory before rethrowing. A failed install leaves the fallback as if nothing had been attempted: parent-directory resolution is not defeated, and the next install or boot observes the absence instead of a broken package.

## Alternatives considered

**Extract into a staging directory and rename into place.** Rejected as more machinery than the failure mode needs: the target is removed at the start of every install anyway, so on failure there is no previous good copy to preserve; deleting the partial state is the whole fix.

**Leave the residue and teach resolution to skip empty directories.** Rejected because it papers over installer failure at every consumer and keeps the confusing "Cannot find package" for a visible directory.

## Consequences

A failed or cancelled dependency install can no longer break later boots. The regression test rejects an integrity-mismatched install and asserts the target directory is absent afterwards. Directories left on machines that already hit this (an empty `ssh2` or `cloudflared` under `~/.dsh/profiles/node_modules`) are removed by hand or replaced with real content by the next successful install.

## Related

[User plugin installation and update pipeline](../../implemented/architecture/2026-08-14-user-plugin-install-and-update.md) owns the flat module fallback and the bundle dependency walk; this note fixes its failure residue.
