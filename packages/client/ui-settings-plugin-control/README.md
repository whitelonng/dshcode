# @deepseek-ai/dsh-client-ui-settings-plugin-control

English | [中文](README.zh.md)

The **Plugin switches** tab for Web Settings. The browser plugin contributes id `controls` to the root-scoped `settings.plugins.tab` list and registers its own English and Simplified Chinese copy. It performs no privileged request during activation; selecting the tab mounts the component and lazily reads the configured logical products through the generic Connection channel `/plugin-control`.

Each product card shows its deployment-provided name, upstream repository link, saved aggregate state, and an accessible `role="switch"` control. A mutation disables the other switches while pending, replaces the local snapshot with the Host response, and displays a restart notice after the setting is saved. Loading, empty, unavailable, retry, and generic failure states do not expose transport or filesystem details. The registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the Plugins section owner.

Remote browsers receive a local-only notice and never call the control route. The Host applies the same loopback trust decision at the route, so hiding the controls is presentation rather than the security check.

## Model Experience

### Browser plugin selection

#### What the model sees

Nothing from `Plugin switches`. It renders and mutates deployment settings in the browser and registers no model-facing content; after restart, a controlled plugin may contribute its own content.

#### Token effect

Zero in the current process. Any post-restart token change belongs to the controlled plugin.

#### KV Cache effect

None in the current process; any post-restart effect belongs to the enabled or disabled plugin.

## Known Limitations and Deferred Work

- **Restart required** — a successful switch updates desired state and the profile patch but deliberately leaves the running plugin mounted or unmounted.
- **One snapshot per mount, retry, or mutation** — the tab has no Loader or filesystem subscription; switching tabs preserves the current component state.
- **Deployment-defined grouping** — one card may govern several Loader rows, and a missing or duplicated row makes that entire card unavailable.
