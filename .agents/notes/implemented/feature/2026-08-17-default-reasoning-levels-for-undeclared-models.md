# Agent Note: Default reasoning levels for undeclared third-party models

Status: implemented

English | [中文](2026-08-17-default-reasoning-levels-for-undeclared-models.zh.md)

## Problem

A hand-declared pi-ai model — the model list of a user-created provider route — that carries no `reasoningEfforts` declaration was reported as non-reasoning (`reasoning: false`), so the composer's model picker offered no thinking-level control at all. Users with a plain OpenAI-compatible gateway therefore could not choose or adjust thinking strength for their models, even though most such gateways serve the common thinking levels. The settings editor mirrored the gap: its level checkbox group showed nothing checked for a model that declared nothing.

## Decision

A hand-declared model without a `reasoningEfforts` declaration defaults to the `off` / `low` / `max` offer in both surfaces:

- **Adapter** (`packages/llm/llm-pi-ai/src/catalog.ts`, `resolveModelReasoning`): when the field is absent and the model id matches no installed catalog entry, the materialized model carries `reasoning: true` with a thinking-level map that supports exactly `off`, `low`, and `max` — `off` and `low` stay absent from the map (pi-ai's supported-with-default dispatch: send nothing / send the level name), `max` carries its own name as the wire spelling because pi-ai would otherwise pin it unsupported, and every other level is pinned `null`. A model redeclaring a catalog id keeps inheriting the catalog entry's capability unchanged.
- **Editor** (`packages/client/ui-settings-models`, `ModelListEditor` via `DEFAULT_UNDECLARED_EFFORTS`): the checkbox group pre-checks `off` / `low` / `max` when nothing is stored, so the shown state matches the effective default. The pre-check is display-only — the stored value stays `undefined` until a level is toggled, and toggling builds the declaration on top of the default offer.

`off` / `low` / `max` is the smallest honest default: `off` is the omission spelling, and `low` / `max` are the bounds most OpenAI-compatible gateways accept, spelled with the wire fallback (the level name). The profile can still declare any other set — or `false` for a non-reasoning model — explicitly.

## Alternatives considered

**Offer all five base levels by default.** An absent map key means "supported" for the five base levels in pi-ai's defaulting, so omitting the map would advertise `off` through `high`. Rejected: it advertises levels the user never asked for, and the requested product behavior names exactly three.

**Editor-only default, no adapter change.** Pre-checking the boxes without the adapter default would still leave the picker empty until the user saved the form. The adapter default is what makes an untouched hand-declared model selectable in the composer.

**`false` (non-reasoning) as the default, as before.** That is the gap the request closes: users could not modify thinking strength at all.

## Consequences

Hand-declared models now advertise `off` / `low` / `max` in the composer picker out of the box; previously they advertised nothing. The catalog-shadowed inheritance path is unchanged, and `reasoningEfforts: false` still strips reasoning. The editor's pre-checked state is display-only, so merely opening and saving a form does not rewrite a catalog model's inherited capability. Tests pin both surfaces: the adapter's map and supported levels, and the editor's pre-checked offer plus toggle-on-top behavior.
