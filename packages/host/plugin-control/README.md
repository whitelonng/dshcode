---
description: "Loopback-only persistence for a deployment-owned set of logical plugin switches: projects enabled/disabled/mixed/unavailable state, rewrites only marked YAML items in the profile patch, and uninstalls a product by marking it uninstalled."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-control

English | [中文](README.zh.md)

## Summary

Loopback-only persistence for a deployment-owned set of logical plugin switches. The composing profile supplies an absolute `profilePatchPath` and a `controls` catalog; each item names a stable control id, display name, HTTP(S) repository URL, and one or more profile-local Loader entry ids paired with their module specifiers. `PluginControlGateway` projects `enabled`, `disabled`, `mixed`, or `unavailable` state and exposes `list`, `set-enabled`, and `uninstall` on the generic Connection channel `/plugin-control`. `set-enabled` validates the request, serializes concurrent writes, and rewrites only YAML items marked `# dsh-plugin-control: <id>` in the current profile's `cordis.patch.yml`. The route accepts only loopback-authority requests; a remote browser cannot list or mutate controls, and callers cannot address an arbitrary Loader entry outside the deployment catalog.

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

Compose the package into a Host composition with a `profilePatchPath` and a `controls` catalog; the gateway mounts on the Connection channel `/plugin-control` and answers only loopback-authority requests.

### When to choose it

Choose this package when a deployment must let an operator toggle a known set of plugin products across restarts, without exposing a general plugin mutation API. Skip it when there is no deployment-fixed catalog, or when plugins are enabled and disabled out-of-band; the [`plugin-installer`](../../../packages/host/plugin-installer/README.md) gateway owns arbitrary user-installed plugins instead.

### Minimal configuration

The composing profile supplies `profilePatchPath` (absolute path to the profile's `cordis.patch.yml`) and the `controls` catalog; each item carries a stable id, display name, repository URL, and its Loader entry ids plus module specifiers.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`set-enabled` validates the requested control, serializes concurrent writes, and rewrites only YAML items marked `# dsh-plugin-control: <id>` in the current profile's `cordis.patch.yml`. Rows ride an `insert` item carrying each entry's id and module name (the user patch layer applies bare rows as overrides of existing entries, so enabling a never-mounted product must insert, not override). Enabling writes the insert rows; disabling without mounted rows is already the effective state and writes nothing. The writer uses the shared file lock and atomic publication helpers, creates a missing file with private permissions inside the existing profile directory, and preserves unrelated rows, comments, and `!!js` expressions. Community plugins are not required to support reversible runtime registration, so the running Loader tree is not mutated; the returned snapshot reflects the saved setting, and the next DSH process applies it through the ordinary profile patch order. `uninstall { pluginId }` replaces the product's managed rows with an `uninstalled: true` marker item, hides it from `list` across restarts, and its rows stop mounting on the next boot; re-enabling the product rewrites the managed item and clears the marker.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Host plugin-installer gateway](../../../packages/host/plugin-installer/README.md)
- [Settings seam](../../../packages/settings/settings/README.md)
- [Profile patch composition](../../../docs/cordis-primer.md)

-----

<a id="model-experience"></a>
## Model Experience

### Restart-time plugin selection

#### What the model sees

Nothing from `plugin-control`. It registers no prompt, tool, message, or model provider; after DSH restarts, the selected plugins determine which of their own model-visible contributions are present.

#### Token effect

Zero in the running process. After restart, token changes belong to the enabled or disabled plugins.

#### KV Cache effect

None in the running process. After restart, enabling or disabling a plugin can change the request prefix or tool list according to that plugin's own behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Restart required** — switches persist desired state but do not unload or reload the current plugin fiber because third-party plugins may retain routes, tools, or other registrations after teardown.
- **Configured products only** — the endpoint controls only the logical catalog supplied by the deployment; it is not a general mutation API for the Loader inventory.
- **Later layers still win** — a home-level patch or command-line overlay applied after the profile patch can override the saved setting at the next boot.
- **No filesystem subscription** — direct edits made after startup are not reflected in the current gateway snapshot until the process restarts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the control gateway owns no cross-plugin runtime relation.
