# dsh-client-ui-settings-plugins

English | [中文](README.zh.md)

The **Plugins** settings section and its **Plugin configuration** tab. The section owns the heading and compact tab chrome; feature plugins contribute pages through `settings.plugins.tab`. This package's own tab shows one expandable card per Host plugin whose configuration a user owns. A card shows the plugin's name and what it governs; expanding it in place reveals hand-written controls bound to that plugin's settings namespace, each field marking whether the user overrode it and offering a reset back to the value the deployment composed.

## What appears here

A card renders only when its namespace is both registered by a live Host plugin and served to the browser. A deployment that does not compose the owning plugin — or serves the namespace to no client — renders nothing for it rather than an empty or disabled card, so the configurable tab reflects what this deployment actually runs.

The first batch covers the shell executor (`bash`), the agent loop's tool-call parallelism (`agent-loop`), and the DeepSeek search provider (`web-search-deepseek`).

## Extension point

The section declares `settings.plugins.tab`, a root list slot whose labels become ordered tabs. It keeps a tab mounted after its first selection, so local drafts and read-only snapshots survive tab switches. The package registers its own `configurable` contribution, which declares the nested `settings.plugin.item` list slot. A plugin that ships a browser half registers its own card into that nested slot and owns its controls; this package neither enumerates namespaces nor renders a form it was not given. Both levels follow the contribution's `order`.

## Writes

A card stages what the user types and writes it only when they save. Each control renders staged text, so what is on screen is exactly what a save would store; **Discard** drops the drafts, and a card holding unsaved edits says so on its header even while collapsed. A reset stages the composed default rather than writing immediately, and a draft the field does not accept blocks the save instead of being dropped.

Saving writes each staged field through the client settings scope, which fences every write with the namespace revision it read, so a form that has drifted from the document is refused rather than overwriting a concurrent change. The Host is the only authority on whether a value was accepted — its validators own the constraints no schema can express — so the card reads the section back afterwards and reports a save that did not land, keeping those drafts for the user to correct.

A key can also be written from another surface — the Models page addresses the same reference — which changes no settings section, so the card re-reads on the forwarded `credentials/updated` event for the reference it watches.

A field's presence in the raw user layer — not its value — is what marks it overridden; a reset clears that field so it re-inherits the composition layer. Secret-role fields never ride a response, so a key control starts blank, reports only whether one is configured, and writes through the credentials domain rather than the settings section; a blank draft writes nothing and keeps the stored key.

## Model Experience

None, as the section renders a browser configuration UI; the values it writes reach a model only through the plugins that own them, each documenting that effect itself.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Only host-plane plugins appear** — a plugin an agent preset mounts carries its configuration inline in that preset's `agent.cordis.yml` and cannot register a settings namespace at all (a second session mounting the same preset would fail on a duplicate registration), so this section lists nothing for it. Editing those values remains the preset editor's job.
- **Exposure is a Host allowlist, not a plugin declaration** — a namespace absent from the api-proxy's allowlist answers `settings-not-exposed` even when its owner registered it, so a plugin distributed outside this repository cannot surface its own configuration here without a change in `packages/host/apiproxy`.
- **The shell card follows the composed executor** — the POSIX and PowerShell executor families share the `bash` namespace because a host composes exactly one of them, so the served schema differs by platform (PowerShell adds `pwshPath`) even though the card edits the same two fields on both, and a deployment composing neither shows no card.
- **The empty line counts registered cards, not visible ones** — a card whose namespace this deployment does not expose renders nothing, but still counts, so a deployment that exposes none shows an empty list rather than the empty line. The count is also read once, because the renderer caches a root entry's inject face; a card registered later does not raise it.
