# @deepseek-ai/dsh-client-ui-settings

English | [中文](README.zh.md)

The settings domain's base layer, with no presentation of its own. It provides `ctx.settingsScope`, the Host transport every preference row binds its durable namespace section through; `ctx.settingsSchema`, the synchronous schema-rehydration, validation, and immutable path-editing service used by settings plugins; and the settings slot types registrants fill: `settings.trigger` / `settings.header` / `settings.close` (chrome content), `settings.action` (ordered content-header actions), `settings.section` (one page per feature), `settings.plugins.tab` (feature-owned pages inside the Plugins section), and `settings.onboarding` (ordered feature-owned pages). It depends on no `ui-*` presentation package, so any feature that owns a preference can reach it; the settings SHELL — the `sidebar.settings` occupant, its navigation, and the chrome — lives in ui-settings-general, because a shell dependency on ui-sidebar would close a reference graph cycle through ui-layout and ui-theme. The shell's own contract types live beside the shell for the same reason.

The plugin injects `connection` and `remote` and owns the one `settings.describe` reader in the browser: a shared mirror holding the whole answer, refreshed on every forwarded `settings/document-updated` event and on `connection/reset` (the first connection included — that read closes the window where a commit lands between the eager read and the SSE subscription). Schema operations are synchronous and live on the `settingsSchema` service. `ctx.settingsScope.bind(spec)` returns a per-namespace scope DERIVED from the mirror on the CALLER's context — the scope's disposer belongs to the calling fiber, binding adds no wire read, a row's activation never blocks on the settings transport, and every derived surface shows the same document revision at any moment. Cross-namespace surfaces (schema introspection, the served-namespace directory, `hasDocument`) read the same mirror through `ctx.settingsScope.describe()`, a read/fold face (`getSnapshot`/`subscribe`/`ensure`, plus `acceptView` folding a write answer in). The scope snapshot carries the resolved section, composition `base`, raw `user`, revision, writability, and host/memory mode; a field is overridden when it is present in `user`, even when its value equals `base`, and `unset` clears that override. Writes stay per-scope: one field path fenced by the namespace revision as `expectedRevision`; a committed write folds its answer back into the mirror with no re-read, a rejected or failed latest write triggers one mirror recovery read, and a superseded one leaves recovery to its successor. Without a `decode` in the spec, a section that is not a plain object, fails its rehydrated schema, or carries a schema envelope this client cannot rehydrate publishes no value at all, so a row renders its own absent state instead of a half-decoded one. The cold-boot read count is pinned by `apps/web/tests/startup-rpc-budget.e2e.ts`; a new direct `settings.describe` caller in client code is a regression against it.
## Model Experience

None, as the settings domain base serves browser preference storage and slot declarations; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Remote browsers get no durable settings** — the settings RPCs are loopback-only, so a scope bound in a non-loopback browser starts `unavailable` and never crosses the wire; every row it backs is inert there.
- **One field per write** — `set` sends a single `set` op, so a row that must move two fields together has no transaction and publishes two revisions.
