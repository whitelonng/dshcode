---
description: "Loopback-only plugin installation and updates for the current profile: the /plugin-installer gateway installs from npm or git, checks updates, mirrors enablement, records boot failures, and exposes four model-facing plugin tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-installer

English | [中文](README.zh.md)

## Summary

Loopback-only plugin installation and updates for the current profile. The gateway (`/plugin-installer`) is registered on the Connection channel with `authority: 'loopback'` and exposes list, install, update, uninstall, set-enabled, check-updates, failures, and set-safe-mode. It installs from an npm spec or git repository URL, records each plugin in `$DSH_HOME/plugins.json`, and merges managed `insert` patch rows into the profile user patch layer so the plugin loads after restart. It also registers four model-facing tools (`plugin_search`, `plugin_install`, `plugin_uninstall`, `plugin_status`) that read and write the same install state as the browser panel. All mutations are serialized, the state file is written atomically under a lock, and patch-layer edits preserve every unowned YAML node.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose the package into a Host composition that mounts the Connection channel; the gateway answers only loopback-authority requests. It exposes:

- `list` — the installed snapshot from `$DSH_HOME/plugins.json`, each row with its saved enablement read from the managed profile patch row.
- `install { spec }` — installs from an npm spec (`name`, `name@version`, `name@range`) or a git repository URL, then records the plugin and inserts a managed `insert` patch item into the profile user patch layer; the plugin loads after an application restart.
- `status` — the current install/update progress (`idle`, or `fetch`/`download`/`extract`/`write` with an optional download percent) polled by the browser while a mutation runs.
- `update { id }` — re-installs one plugin from its recorded source and refreshes the row.
- `uninstall { id }` — removes the install directory, the managed patch row, and the state entry.
- `set-enabled { id, enabled }` — persists one plugin's next-start enablement by rewriting its managed patch row with a `disabled` flag; the running Loader is untouched until restart.
- `check-updates` — compares npm `dist-tags.latest` (or the remote HEAD for git sources) against installed versions without mutating anything; offline or vanished sources are skipped per plugin.
- `failures` — the recorded boot failures (`$DSH_HOME/boot-failures.json`, a bounded per-plugin ring), the absolute plugin install root (`$DSH_HOME/profiles`), and whether the desktop is running in safe mode.
- `set-safe-mode { enabled }` — creates or removes the safe-mode marker file (`$DSH_HOME/safe-mode`) that the desktop shell reads at launch to skip the user patch layers; toggled together with an application restart.

Uninstalling a plugin also clears its recorded boot failures.

### When to choose it

Choose this package when the deployment must let an operator install, update, or remove the profile's user-added plugins and let an agent repair a failed one. Skip it when plugins are managed out-of-band and never user-installed; the [`plugin-control`](../../../packages/host/plugin-control/README.md) gateway owns a fixed deployment catalog instead.

### Minimal configuration

The gateway mounts on the Connection channel with `authority: 'loopback'`; pnpm availability is probed automatically, and the optional `githubMirror` config prepends a mirror prefix to codeload and api.github.com URLs for restricted networks.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

npm packages are resolved against the configured registry (default `npm_config_registry`, then npmjs), downloaded as tarballs, verified against the registry's `dist.integrity` SRI declaration when present (mismatches and unsupported algorithm sets fail loud; the pinned integrity is recorded in `plugins.json`), and extracted into the flat module fallback `$DSH_HOME/profiles/node_modules/<name>`. GitHub repositories (`github:user/repo` shorthand or `https://github.com/user/repo`, optionally with a `#ref` suffix pinning a branch, tag, or commit) download their source tarball from codeload and resolve their commit through the GitHub API — no `git` binary is needed and the CDN download avoids clone stalls, while `GITHUB_TOKEN`/`GH_TOKEN` lifts the unauthenticated API rate limit. Other git hosts shallow-clone (requires the `git` binary); a GitHub URL falls back to the same shallow clone when its tarball path fails and git exists (a codeload 404 is final). The checkout's identity is validated before anything is written — a repository whose root has no `package.json`, a multi-package workspace root, or an invalid package name fails with a typed error naming the URL. The package's declared entry point must exist in the installed directory — a repository that does not commit its build output fails at install time instead of crashing the Loader at boot. A monorepo shell around exactly one package installs as that package. Bundle-style packages (declaring `dsh.bundle.patch`) additionally install their transitive npm `dependencies` into the fallback and merge the bundle's patch rows into the profile user patch layer, each marked `# dsh-plugin-bundle: <id>`.

Registry and GitHub requests carry hard timeouts sized for slow, rate-limited networks (30 s npm metadata, 60 s npm tarballs, 30 s GitHub API, 300 s GitHub tarballs) so a stalled network surfaces as an error instead of leaving the UI in a permanent installing state. All mutations are serialized; the state file is written atomically under a lock, and patch-layer edits preserve every unowned YAML node, comment, and `!!js` expression.

When pnpm is available the gateway delegates install/update/uninstall to `pnpm add`/`remove` in the profile workspace; the probe checks `pnpm` on PATH, then static absolute paths, then every node version under the nvm and fnm directories. The optional `githubMirror` config (an http(s) URL prefix, validated at load) is prepended to the codeload and api.github.com URLs for restricted networks; the web profile passes `DSH_GITHUB_MIRROR` from the layered `.env` through it. The `disableControlsOnInstall` rules (`[{ id, matches }]`) disable a named plugin-control product's patch rows after an install or update whose package name contains any `matches` substring.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Host plugin-control gateway](../../../packages/host/plugin-control/README.md)
- [Web Plugins settings tab](../../../packages/client/ui-settings-plugin-installer/README.md)
- [Settings seam](../../../packages/settings/settings/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Agent tools

#### What the model sees

The gateway registers four model-facing tools (`plugin_search` / `plugin_install` / `plugin_uninstall` / `plugin_status`) that read and write the same install state as the browser panel: `plugin_search { query?, source?, refresh? }` renders catalog entries from the registered index sources as one text line per entry (id, kind, source, capability faces, description, owning source and its trust level); `plugin_install { source }` returns one install result line (the installed id and version plus the restart requirement); `plugin_uninstall { id }` returns one removal-result line; `plugin_status { id? }` returns one line per installed plugin (id@version, install source, and a disabled marker). Their names, descriptions, and JSON-Schema parameters are catalogued in [tool-catalog.md](../../../docs/tool-catalog.md) and reach the model through the ordinary system-prompt tool assembly.

#### Token effect

The four tool schemas join the tool catalog the system prompt emits; execution results are short text lines bounded by the installed/catalog entry counts.

#### KV Cache effect

None beyond the shared tool-catalog assembly every model request already carries.

### Loopback gateway

#### What the model sees

Nothing: the `/plugin-installer` RPC channel is loopback-only, performs no model requests, and registers no other model-facing content. Downloads (configured npm registry, codeload, GitHub API) and the `pnpm`/`git` subprocesses never produce model-visible output.

#### Token effect

None in the current process; install traffic stays in the host and never reaches a model request.

#### KV Cache effect

None; the gateway contributes nothing to any provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Tarballs whose packument declares no `dist.integrity` are transport-trusted (HTTPS) but not content-verified.
- A configured `githubMirror` is a third-party service that sees (and could alter) the downloaded content — the mirror prefix is opt-in and should be set knowingly.
- Non-GitHub git sources require the `git` binary on the machine (Windows installs may lack it; GitHub repositories download from codeload without git, but the GitHub API's unauthenticated rate limit of 60 requests/hour applies to commit lookups unless `GITHUB_TOKEN`/`GH_TOKEN` is set); repositories without a root `package.json` (or empty repositories) are rejected — only single-package Node repositories install, and multi-package workspace roots must be installed from their published npm package instead.
- The dependency tree installs only for bundle-style packages (`dsh.bundle.patch`); ordinary plugins resolve their dependencies from the application's shipped closure.
- Bundle-installed dependency packages remain in the fallback after the aggregating plugin is uninstalled — they are untracked support files, not recorded plugins; a later install reuses a matching copy or refreshes it to the new target version.
- A bundle insert row whose id the profile patch already owns is skipped, so the existing row (for example a preset product row) stays the single authority for that entry.
- Installed plugins run with full host privileges after restart — installing arbitrary packages is a code-execution decision the user owns.
- The boot-failure ring records JS-catchable load failures, boot timeouts, and late rejections; a hard crash or a main-thread hang leaves no record (the desktop's boot marker covers those recovery paths instead).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the installer gateway owns no cross-plugin runtime relation.
