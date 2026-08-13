# @deepseek-ai/dsh-host-plugin-control

English | [中文](README.zh.md)

Loopback-only persistence for a deployment-owned set of logical plugin switches. The composing profile supplies an absolute `profilePatchPath` and a `controls` catalog; each catalog item has a stable control id, display name, HTTP(S) repository URL, and one or more profile-local Loader entry ids. `PluginControlGateway` resolves every local id to exactly one mounted entry, projects `enabled`, `disabled`, `mixed`, or `unavailable` state, and exposes `list` plus `set-enabled` on the generic Connection channel `/plugin-control`.

`set-enabled` validates the requested control, serializes concurrent writes, and rewrites only YAML rows marked `# dsh-plugin-control: <id>` in the current profile's `cordis.patch.yml`. The writer uses the shared file lock and atomic publication helpers, creates a missing file with private permissions inside the existing profile directory, and preserves unrelated rows, comments, and `!!js` expressions. Community plugins are not required to support reversible runtime registration, so the running Loader tree is not mutated; the returned snapshot reflects the saved setting, and the next DSH process applies it through the ordinary profile patch order.

The route accepts only loopback-authority requests. A remote browser cannot list or mutate controls through this channel, and callers cannot address an arbitrary Loader entry outside the deployment catalog. Invalid YAML, missing or ambiguous entries, unsafe repository URLs, duplicate ownership, and unknown control ids fail without replacing the existing patch file.

## Model Experience

### Restart-time plugin selection

#### What the model sees

Nothing from `plugin-control`. It registers no prompt, tool, message, or model provider; after DSH restarts, the selected plugins determine which of their own model-visible contributions are present.

#### Token effect

Zero in the running process. After restart, token changes belong to the enabled or disabled plugins.

#### KV Cache effect

None in the running process. After restart, enabling or disabling a plugin can change the request prefix or tool list according to that plugin's own behavior.

## Known Limitations and Deferred Work

- **Restart required** — switches persist desired state but do not unload or reload the current plugin fiber because third-party plugins may retain routes, tools, or other registrations after teardown.
- **Configured products only** — the endpoint controls only the logical catalog supplied by the deployment; it is not a general mutation API for the Loader inventory.
- **Later layers still win** — a home-level patch or command-line overlay applied after the profile patch can override the saved setting at the next boot.
- **No filesystem subscription** — direct edits made after startup are not reflected in the current gateway snapshot until the process restarts.
