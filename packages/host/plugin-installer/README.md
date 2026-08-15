English | [中文](README.zh.md)

# dsh-host-plugin-installer

Loopback-only plugin installation and updates for the current profile. The gateway (`/plugin-installer`) is registered on the Connection channel with `authority: 'loopback'` and exposes:

- `list` — the installed snapshot from `$DSH_HOME/plugins.json`, each row with its saved enablement read from the managed profile patch row.
- `install { spec }` — installs from an npm spec (`name`, `name@version`, `name@range`) or a git repository URL. npm packages are resolved against the configured registry (default `npm_config_registry`, then npmjs), downloaded as tarballs, verified against the registry's `dist.integrity` SRI declaration when present (mismatches and unsupported algorithm sets fail loud; the pinned integrity is recorded in `plugins.json`), and extracted into the flat module fallback `$DSH_HOME/profiles/node_modules/<name>`; GitHub repositories (`github:user/repo` shorthand or `https://github.com/user/repo`, optionally with a `#ref` suffix pinning a branch, tag, or commit) download their source tarball from codeload and resolve their commit through the GitHub API — no `git` binary is needed and the CDN download avoids clone stalls, while `GITHUB_TOKEN`/`GH_TOKEN` lifts the unauthenticated API rate limit (60 requests/hour); other git hosts shallow-clone (requires the `git` binary; the `github:user/repo` shorthand is normalized to `https://github.com/user/repo.git` and the `git+` prefix stripped, so clones do not depend on local git config), and a GitHub URL falls back to the same shallow clone when its tarball path fails and git exists (a codeload 404 is final — the repository does not exist). The checkout's identity is validated before anything is written — a repository whose root has no `package.json`, a multi-package workspace root (declared `workspaces`; a `private: true` single package is accepted — git-only plugins ship that way), or an invalid package name fails with a typed error naming the URL. The package's declared entry point (a string `exports`, a string `exports["."]`, `main`, default `index.js`) must exist in the installed directory — a repository that does not commit its build output fails at install time with the build-and-commit advice instead of crashing the Loader at boot. A monorepo shell around exactly one package (root without `package.json`, a single manifest anywhere below it, `node_modules`/`.git` skipped) installs as that package — the sole manifest is promoted to the root; several manifests fail loud naming them. Pasting a whole `dsh plugin --profile <name> add <spec>` / `pnpm add <spec>` / `npm install <spec>` command installs its spec directly; other shell commands are rejected with a hint to paste only the package name or repository URL. The install then records the plugin in `plugins.json` and inserts a managed `insert` patch item into the profile user patch layer (`cordis.patch.yml`) — the user layer applies bare rows as overrides of existing entries, so installs must ride `insert` items — the plugin loads after an application restart. Bundle-style packages (declaring `dsh.bundle.patch`) additionally install their transitive npm `dependencies` into the fallback (an existing copy is replaced only when its version differs from the resolved target, which upgrades a shipped dependency to the aggregated version) and merge the bundle's patch rows into the profile user patch layer, each marked `# dsh-plugin-bundle: <id>`: insert rows whose ids the patch already owns (a preset product row, the plugin's own installer row) are skipped so no entry is mounted twice, bare override rows append verbatim, and a re-install or update replaces the plugin's earlier merged rows. `set-enabled` mirrors the plugin's flag onto its merged bundle rows, and `uninstall` removes them.
- `status` — the current install/update progress (`idle`, or `fetch`/`download`/`extract`/`write` with an optional download percent) polled by the browser while a mutation runs.
- `update { id }` — re-installs one plugin from its recorded source and refreshes the row.
- `uninstall { id }` — removes the install directory, the managed patch row, and the state entry.
- `set-enabled { id, enabled }` — persists one plugin's next-start enablement by rewriting its managed patch row with a `disabled` flag; the running Loader is untouched until restart.
- `check-updates` — compares npm `dist-tags.latest` (or the remote HEAD for git sources) against installed versions without mutating anything; offline or vanished sources are skipped per plugin.
- `failures` — the recorded boot failures (`$DSH_HOME/boot-failures.json`, a bounded per-plugin ring: at most 8 records, truncated fields, 90-day retention, whole-file byte cap), the absolute plugin install root (`$DSH_HOME/profiles`), and whether the desktop is running in safe mode. The desktop shell writes and sweeps the same file through the shared helpers re-exported from this package (`writeBootFailure`, `clearBootFailures`, `pruneBootFailures`, `readBootFailures`, plus the safe-mode marker `setSafeMode`/`readSafeMode` and the patch/state helpers the recovery flow reuses).
- `set-safe-mode { enabled }` — creates or removes the safe-mode marker file (`$DSH_HOME/safe-mode`) that the desktop shell reads at launch to skip the user patch layers; toggled together with an application restart.

Uninstalling a plugin also clears its recorded boot failures.

Registry and GitHub requests carry hard timeouts sized for slow, rate-limited networks (30 s npm metadata, 60 s npm tarballs, 30 s GitHub API, 300 s GitHub tarballs) so a stalled network surfaces as an error instead of leaving the UI in a permanent installing state.

All mutations are serialized; the state file is written atomically under a lock, and patch-layer edits preserve every unowned YAML node, comment, and `!!js` expression.

When pnpm is available the gateway delegates install/update/uninstall to `pnpm add`/`remove` in the profile workspace; the probe checks `pnpm` on PATH, then static absolute paths (`/opt/homebrew/bin/pnpm`, `/usr/local/bin/pnpm`, `~/Library/pnpm/pnpm`, `~/.local/share/pnpm/pnpm`, `~/.volta/bin/pnpm`, `~/.local/bin/pnpm`, `~/bin/pnpm`), then every node version under the nvm and fnm directories — GUI apps on macOS do not inherit the shell PATH, and the spawn environment augments PATH with those directories so pnpm's `env node` shebang resolves too. The optional `githubMirror` config (an http(s) URL prefix, for example `https://gh-proxy.com/`, validated at load) is prepended to the codeload and api.github.com URLs for restricted networks; the web profile passes `DSH_GITHUB_MIRROR` from the layered `.env` through it. The `disableControlsOnInstall` rules (`[{ id, matches }]`) disable a named plugin-control product's patch rows after an install or update whose package name contains any `matches` substring — the web profile uses it so a user-installed webui suite turns the built-in web-ui product off instead of double-mounting.

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

- Tarballs whose packument declares no `dist.integrity` are transport-trusted (HTTPS) but not content-verified.
- A configured `githubMirror` is a third-party service that sees (and could alter) the downloaded content — the mirror prefix is opt-in and should be set knowingly.
- Non-GitHub git sources require the `git` binary on the machine (Windows installs may lack it; GitHub repositories download from codeload without git, but the GitHub API's unauthenticated rate limit of 60 requests/hour applies to commit lookups unless `GITHUB_TOKEN`/`GH_TOKEN` is set); repositories without a root `package.json` (or empty repositories) are rejected — only single-package Node repositories install, and multi-package workspace roots must be installed from their published npm package instead.
- The dependency tree installs only for bundle-style packages (`dsh.bundle.patch`); ordinary plugins resolve their dependencies from the application's shipped closure.
- Bundle-installed dependency packages remain in the fallback after the aggregating plugin is uninstalled — they are untracked support files, not recorded plugins; a later install reuses a matching copy or refreshes it to the new target version.
- A bundle insert row whose id the profile patch already owns is skipped, so the existing row (for example a preset product row) stays the single authority for that entry.
- Installed plugins run with full host privileges after restart — installing arbitrary packages is a code-execution decision the user owns.
- The boot-failure ring records JS-catchable load failures, boot timeouts, and late rejections; a hard crash or a main-thread hang leaves no record (the desktop's boot marker covers those recovery paths instead).
