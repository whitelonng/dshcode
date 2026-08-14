English | [中文](README.zh.md)

# dsh-client-ui-settings-plugin-installer

Plugin install and update tab in Web Plugins settings (`settings.plugins.tab`, id `installer`). The tab provides:

- **安装 (Install)** — install one plugin from an npm spec (`name`, `name@version`, `name@range`) or a git repository URL into the profile's shared module fallback; the host records the source in `$DSH_HOME/plugins.json` and inserts the loader row into the profile user patch layer.
- **检查更新 (Check for updates)** — compares installed versions against npm `dist-tags.latest` (or the remote HEAD for git sources) and shows per-row update badges.
- **更新 (Update)** — re-installs from the recorded source and refreshes the list.
- **卸载 (Uninstall)** — requires confirmation, then removes the install directory, the patch row, and the state entry.

Installs and updates end with a restart affordance: on the desktop shell the preload bridge restarts the application in place (`window.dshDesktop.restart()`); in the browser a hint explains that a restart of the `dsh web` process applies the change.

## Model Experience

### Browser plugins tab

#### What the model sees

Nothing from the `installer` tab. The tab performs no model requests and registers no model-facing content; the host downloads packages from the configured npm registry or git remote.

#### Token effect

Zero in the current process.

#### KV Cache effect

None in the current process; the tab contributes nothing to any provider request.

## Known Limitations and Deferred Work

- Git sources require the `git` binary on the machine; npm sources download over HTTPS with no integrity pinning yet.
- Update detection is source-comparison only (`dist-tags.latest` / remote HEAD); pre-release versions are never selected for npm ranges.
- Installing arbitrary packages runs their code with full host privileges on restart — the UI states this implicitly through the restart flow; review the source before installing.
