English | [中文](README.zh.md)

# dsh-client-ui-settings-plugin-installer

Merged plugin list tab in Web Plugins settings (`settings.plugins.tab`, id `plugins`). The tab provides:

- **安装 (Install)** — install one plugin from an npm spec (`name`, `name@version`, `name@range`) or a git repository URL into the profile's shared module fallback; the host records the source in `$DSH_HOME/plugins.json` and inserts the loader row into the profile user patch layer.
- **检查更新 (Check for updates)** — compares installed versions against npm `dist-tags.latest` (or the remote HEAD for git sources) and shows per-row update badges.
- **更新 (Update)** — re-installs from the recorded source and refreshes the list.
- **卸载 (Uninstall)** — requires confirmation, then removes the install directory, the patch row, and the state entry.
- **启动失败 (Startup failure)** — a plugin with a recorded boot failure (`$DSH_HOME/boot-failures.json`) shows a badge with the failure summary and two actions: **让 Agent 修复 (Ask the agent to fix)** opens a new conversation whose workspace is the plugin install root (`$DSH_HOME/profiles`) and seeds the first message with the failure record and install path, so the agent edits the plugin code inside its workspace boundary; **复制错误 (Copy error)** copies the failure text for a manual repair conversation.
- **安全模式 (Safe mode)** — when the desktop runs with the user patch layers skipped, a banner explains that switches are disabled and offers **恢复正常模式并重启 (Restore normal mode and restart)**, which clears the safe-mode marker and restarts the application.

Installs, updates, and switches end with a restart affordance: on the desktop shell the preload bridge restarts the application in place (`window.dshDesktop.restart()`); in the browser a hint explains that a restart of the `dsh web` process applies the change.

## Model Experience

### Browser plugins tab

#### What the model sees

Nothing from the `plugins` tab. The tab performs no model requests and registers no model-facing content; the host downloads packages from the configured npm registry or git remote. The repair action creates a regular user conversation whose first message embeds the failure record — that message is model-visible like any user prompt.

#### Token effect

Zero in the current process; the repair conversation consumes tokens only when the user sends it.

#### KV Cache effect

None in the current process; the tab contributes nothing to any provider request.

## Known Limitations and Deferred Work

- Git sources require the `git` binary on the machine; npm sources download over HTTPS with no integrity pinning yet.
- Update detection is source-comparison only (`dist-tags.latest` / remote HEAD); pre-release versions are never selected for npm ranges.
- Installing arbitrary packages runs their code with full host privileges on restart — the UI states this implicitly through the restart flow; review the source before installing.
- Repair conversations fix the installed copy in place; a later reinstall or update overwrites the fix.
