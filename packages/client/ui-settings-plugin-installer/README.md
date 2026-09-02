---
description: "The merged plugin-list tab in Web Plugins settings: installs, updates, uninstalls, checks for updates, and surfaces startup failures and safe mode for the profile's user-installed plugins."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-installer

English | [中文](README.zh.md)

## Summary

The merged plugin-list tab in Web Plugins settings (`settings.plugins.tab`, id `plugins`). The tab installs one plugin from an npm spec or git repository URL into the profile's shared module fallback, compares installed versions against the registry or remote HEAD, updates and uninstalls rows, and surfaces startup failures plus safe-mode state with their recovery actions. Installs, updates, and switch changes end with a restart affordance that restarts the desktop app in place or hints at a `dsh web` restart in the browser. The tab performs no model request itself; only the repair action creates a regular user conversation whose first message embeds the failure record.

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

Compose the package into the client assembly; the `plugins` tab appears under Web Plugins settings and talks to the host plugin-installer gateway over the shared `/api` carrier.

### When to choose it

Choose this package when the GUI must give a human control over the profile's user-installed plugins — installing, updating, uninstalling, or repairing a failed one. Skip it when the host exposes no plugin-installer gateway, or when the deployment manages its plugin set out-of-band and the tab's actions are unnecessary.

### Minimal configuration

No mount: the package registers its settings tab through the ordinary client assembly and injects its wire face from `apply`. The host side must compose the [`plugin-installer`](../../../packages/host/plugin-installer/README.md) gateway for the tab's actions to resolve.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tab drives the host gateway through the shared `/api` fetch carrier. **Install** accepts an npm spec (`name`, `name@version`, `name@range`) or a git repository URL; the host records the source in `$DSH_HOME/plugins.json` and inserts the loader row into the profile user patch layer. **Check for updates** compares installed versions against npm `dist-tags.latest` (or the remote HEAD for git sources) and shows per-row badges. **Update** re-installs from the recorded source and refreshes the list. **Uninstall** requires confirmation, then removes the install directory, the patch row, and the state entry. **Startup failure** shows a badge for a recorded boot failure with the failure summary and two actions — ask the agent to fix (opens a conversation whose workspace is the plugin install root and seeds the failure) or copy the error. **Safe mode** explains that switches are disabled when the desktop skips the user patch layers and offers a restore-and-restart action. The wire face is injected from `apply` and validates responses at the client boundary.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web client architecture](../../../docs/subsystems/web-client.md)
- [Settings seam](../../../packages/settings/settings/README.md)
- [Host plugin-installer gateway](../../../packages/host/plugin-installer/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Browser plugins tab

#### What the model sees

Nothing from the `plugins` tab. The tab performs no model requests and registers no model-facing content; the host downloads packages from the configured npm registry or git remote. The repair action creates a regular user conversation whose first message embeds the failure record — that message is model-visible like any user prompt.

#### Token effect

Zero in the current process; the repair conversation consumes tokens only when the user sends it.

#### KV Cache effect

None in the current process; the tab contributes nothing to any provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Git sources require the `git` binary on the machine; npm sources download over HTTPS with no integrity pinning yet.
- Update detection is source-comparison only (`dist-tags.latest` / remote HEAD); pre-release versions are never selected for npm ranges.
- Installing arbitrary packages runs their code with full host privileges on restart — the UI states this implicitly through the restart flow; review the source before installing.
- Repair conversations fix the installed copy in place; a later reinstall or update overwrites the fix.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
