# Agent Note: User plugin installation and update pipeline

Status: implemented

English | [中文](2026-08-14-user-plugin-install-and-update.zh.md)

> Scope: the loopback plugin-installer gateway (host), the install/update tab (client), and the restart apply channel they consume. Complements [plugin-control](2026-08-14-built-in-community-plugins-and-controls.md) (enable/disable of configured products) with open-ended user installs, and consumes the [desktop restart channel](2026-08-14-desktop-single-row-title-bar.md).

## Problem

Plugin management was closed: `plugin-control` toggles deployment-configured products, and the community family (`dsh-web-ui-all`) was installed by hand into the shared module fallback. There was no way for a user to install a plugin from an npm spec or a repository URL, no record of what was installed or from where, and no update detection — the original WebUI gap the desktop product inherits.

## Decision

### Host: one loopback gateway owns user-plugin installs

`@deepseek-ai/dsh-host-plugin-installer` registers `/plugin-installer` on the Connection channel (`authority: 'loopback'`), configured by the composing profile (`profilePatchPath`, optional `dshHome` and `registry`). Endpoints: `list`, `install { spec }`, `update { id }`, `uninstall { id }`, `check-updates`.

- **Sources.** An npm spec (`name`, `name@version`, `name@range`) resolves against the registry packument (default `npm_config_registry`, then npmjs) with semver range selection (exact → range → `dist-tags.latest`, prereleases excluded from ranges); the tarball is downloaded over HTTPS and extracted with `tar` into the flat module fallback `$DSH_HOME/profiles/node_modules/<name>` (scoped names keep their `@scope/` directory). A GitHub URL (`github:owner/repo`, `https://github.com/owner/repo`, optionally with a `#ref` pin) downloads its source tarball from codeload and resolves its commit through the GitHub API — no `git` binary; other git hosts (git+, git://, https repository paths) shallow-clone with the `git` binary, and a GitHub URL falls back to a clone when its tarball path fails and git exists. The package is staged in a temporary directory, its identity is read and validated, and it is moved to its final fallback location.
- **State.** `$DSH_HOME/plugins.json` records every install: id (package name), display name, version, source kind/spec, install time, and the git commit for repository sources. Writes are atomic under a file lock; a malformed state fails loud.
- **Patch layer.** Every install/update inserts a managed loader row (`id` + `name` = package name, marked with a `dsh-plugin-installer:` comment) into the profile user patch layer via YAML document manipulation that preserves unowned nodes, comments, and `!!js` expressions; uninstall removes it.
- **Updates.** `check-updates` compares npm `dist-tags.latest` (or the remote HEAD for git sources) against the installed version per plugin, degrading silently per plugin when a source is offline or gone.
- **Apply.** The running tree is untouched: packaged Electron cannot hot-apply host plugins, so installs/updates/uninstalls take effect on restart. The client tab ends with the restart affordance (desktop: preload `restart()` → `app.relaunch`; browser: hint text).

### Client: install and update tab

`@deepseek-ai/dsh-client-ui-settings-plugin-installer` registers the `settings.plugins.tab` entry `installer` (order 30): an install box (npm spec or git URL), one row per installed plugin (version, update badge, update/uninstall actions), a check-updates action, and inline failure text. Uninstall requires an explicit confirmation modal. The wire face calls the gateway channel and validates responses in `protocol.ts`. The desktop bridge is read through a local cast — the authoritative `Window.dshDesktop` type stays in the shell (a second global declaration would silently replace it under declaration merging).

## Verification

The host suite covers state round-trips and loud malformed-state failure, spec parsing and semver resolution, patch-row insert/remove with preservation of unowned YAML, and a full gateway flow over a mocked registry (install → list → check-updates → update → uninstall with per-version tarballs) plus typed rejections. The client suite covers protocol validation, the tab flows (list, install, update, confirmed uninstall, restart action, empty state), and the section registration. The web replay suite re-verifies the settings dialog after the new tab row.

## Alternatives considered

**Add integrity pinning (npm `integrity`) to tarball installs.** Rejected: the registry packument carries it, but verification adds a hash pipeline; HTTPS + the user-owned code-execution decision covers v1, documented as a known limitation.

**Install by spawning the npm CLI.** Rejected: packaged Electron ships no npm; the registry HTTP + `tar` path is self-contained, and git remains an explicit machine requirement only for non-GitHub repository sources (GitHub sources install from codeload without it).

**Apply plugin changes via the client HMR channel instead of restart.** Rejected: a new install adds a Loader row, which the host-side config reload — disabled in packaged Electron — would need; the restart channel already exists and is honest about the packaged constraint.

## Consequences

- Users can install, update, and uninstall plugins from npm or git sources entirely from Settings; the install state and sources are durable in `$DSH_HOME/plugins.json`.
- New plugins take effect after an application restart (desktop: one-click via the bridge; browser: restart the `dsh web` process).
- Non-GitHub repository sources require `git` on the machine (GitHub sources download from codeload without it, subject to the GitHub API's unauthenticated rate limit); npm installs have no integrity pinning yet — both documented as known limitations.
- The settings dialog gains one tab (安装与更新), covered by the replayed web suite.

## Related

- [Desktop plugin boot-failure recovery](../../implemented/architecture/2026-08-15-desktop-plugin-boot-recovery.md) reuses this gateway's managed patch-row and state helpers for the disable-and-restart recovery flow, and extends the gateway with the `failures`/`set-safe-mode` endpoints.
- [GitHub plugin installs ride codeload tarballs and the GitHub API](../../implemented/architecture/2026-08-15-github-tarball-installs.md) replaces the shallow clone for GitHub sources; this note's identity validation and commit recording are what that path still runs.
