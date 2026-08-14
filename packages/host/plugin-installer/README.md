English | [中文](README.zh.md)

# dsh-host-plugin-installer

Loopback-only plugin installation and updates for the current profile. The gateway (`/plugin-installer`) is registered on the Connection channel with `authority: 'loopback'` and exposes:

- `list` — the installed snapshot from `$DSH_HOME/plugins.json`.
- `install { spec }` — installs from an npm spec (`name`, `name@version`, `name@range`) or a git repository URL. npm packages are resolved against the configured registry (default `npm_config_registry`, then npmjs), downloaded as tarballs, and extracted into the flat module fallback `$DSH_HOME/profiles/node_modules/<name>`; git sources are shallow-cloned (requires the `git` binary). The install then records the plugin in `plugins.json` and inserts a managed loader row into the profile user patch layer (`cordis.patch.yml`) — the plugin loads after an application restart.
- `update { id }` — re-installs one plugin from its recorded source and refreshes the row.
- `uninstall { id }` — removes the install directory, the managed patch row, and the state entry.
- `check-updates` — compares npm `dist-tags.latest` (or the remote HEAD for git sources) against installed versions without mutating anything; offline or vanished sources are skipped per plugin.

All mutations are serialized; the state file is written atomically under a lock, and patch-layer edits preserve every unowned YAML node, comment, and `!!js` expression.

## Model Experience

### Loopback gateway

#### What the model sees

Nothing from the `/plugin-installer` gateway. The gateway performs no model requests and registers no model-facing content; it downloads packages over HTTPS from the configured registry or spawns `git`.

#### Token effect

Zero in the current process.

#### KV Cache effect

None in the current process; the gateway contributes nothing to any provider request.

## Known Limitations and Deferred Work

- npm tarballs are not integrity-pinned yet; HTTPS is the only transport guarantee.
- Git sources require the `git` binary on the machine (Windows installs may lack it).
- Installed plugins run with full host privileges after restart — installing arbitrary packages is a code-execution decision the user owns.
