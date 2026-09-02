---
description: "Browser-side schema and draft editing layer for settings editors: rehydrates the settings.describe schemastery envelope, resolves schema nodes by settings path, and edits drafts immutably with path-level override semantics."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-schema-form

English | [中文](README.zh.md)

## Summary

The schema/draft model layer for settings editors. `rehydrateSchema` turns the wire's `settings.describe` envelope back into a live schemastery validator, so the schema that validates a section on the Host validates the browser draft with zero drift. `nodeAtPath` resolves the schema node addressed by a configurable-provider directory `settingsPath`, and `setPath`/`deletePath`/`hasPath` edit a draft immutably with presence-based override semantics. `validateDraft` runs the rehydrated validator and returns the failure message, letting pages reject invalid drafts before writing. The package owns no React and no rendering: editors build their own controls over these helpers.

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

Import the helpers from the package root and drive them from an editor component's controller.

### When to choose it

Choose this package when a settings surface must edit a namespace it does not fully own: the configurable-provider Models page probes provider profiles through `nodeAtPath` before deciding what to render. Skip it for a namespace the editor knows completely, where a hand-written typed form over the settings scope is simpler.

### Minimal configuration

No mount: the package registers nothing into a composition. Its invariant companion (`apply` on the `./invariant` entry) is an empty installer, since a pure helper library owns no cross-plugin mutable relation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/model.ts`](src/model.ts) holds the full API: `rehydrateSchema` revives the `schema.toJSON()` ref envelope with `new Schema(json)`; the draft helpers materialize intermediates on `setPath`, drop keys on `deletePath`, and treat field presence as override state. The settings seam's layering gives presence semantics their meaning: an absent key falls back to the composition base and schema defaults.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web client architecture](../../../docs/subsystems/web-client.md)
- [Settings seam](../../../packages/settings/settings/README.md)
- [Web config-plane Agent Note](../../../.agents/notes/implemented/architecture/2026-07-30-web-config-plane.md)
- [Adding a package](../../../docs/cookbook/adding-a-package.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as this package backs browser configuration editors; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Rehydration executes the served envelope** — `rehydrateSchema` reconstructs a live schemastery validator, and schemastery revives serialized callbacks through `new Function`, so the schema envelope is executable content rather than inert data. This is safe only for an envelope from the same trusted host that serves the page; the protocol provides no inert cross-trust representation.
- **Validation is draft-level, not per-field** — `validateDraft` reports schemastery's first failure message, including its `$.path`; it does not map errors onto individual controls.
- **No generic renderer** — consumers build feature-specific forms over these helpers. The [Web config-plane Agent Note](../../../.agents/notes/implemented/architecture/2026-07-30-web-config-plane.md) records that trade-off.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
