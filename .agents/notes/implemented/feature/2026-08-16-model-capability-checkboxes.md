# Agent Note: Model capability checkboxes and reasoning-effort toggles

Status: implemented

English | [中文](2026-08-16-model-capability-checkboxes.zh.md)

> Scope: the Models settings page's model-row editor, the pi-ai and DeepSeek model entries it writes, and the model metadata the composer's selector renders. The [reasoning-efforts declarations note](../architecture/2026-08-14-third-party-model-reasoning-efforts.md) owns the original text-field editor; this note adds the checkbox group on top of it and the capability claims the text field cannot express.

## Problem

The Models settings page edited a third-party model's reasoning efforts only as raw `level: spelling` text, and it had no surface at all for capability claims: whether a model accepts image input, generates images, or understands image content. Only image input had any representation — pi-ai entries could declare `input` and the harness exposed `inputModalities` — while image generation and image understanding had no config field, no `LlmModelInfo` channel, and no UI, so the composer's model selector could not tell those models apart.

## Decision

Each pi-ai model row's disclosure gains a **思考程度 (Reasoning levels)** checkbox group covering pi-ai's full level set (`off` through `max`) plus the existing **禁用推理 (Disable reasoning)** checkbox. Checking a level adds it to the stored `reasoningEfforts` map with its existing wire spelling, or the protocol default when newly offered — the level name itself, with `off` staying empty ("supported, send nothing"); unchecking removes the level, and unchecking the last one yields `false`, the adapters' spelling of a non-reasoning model. A protocol-family hint (OpenAI-completions suggests `minimal` through `high`, anthropic-messages `low` through `xhigh`) sits beside the group, advisory only. The original text field moves behind an **高级 (Advanced)** fold with its parse/format logic unchanged, so a deployment with custom wire spellings never loses them. The DeepSeek editor gains the same group restricted to `off`/`high`/`max` — the levels its wire route can dispatch — writing a new per-model `reasoningEfforts` field that `llm-deepseek` accepts end-to-end: catalog schema, `resolveModels` validation (wire spellings fixed to the route's literals, a map offering only `off` refused in favor of `false`), and exact-model reasoning metadata (offered levels from the map's keys, default the route effort when offered, else the strongest offered thinking level). `thinking: disabled` stays a deployment lock that clamps any per-model declaration to off-only.

The row's three **capability checkboxes** (pi-ai rows only) write new optional entry fields, all absent by default so existing configurations are untouched:

- **图片输入 (Image input)** toggles `image` in the entry's existing `input` array (`text` stays as the floor);
- **生图 (Image generation)** toggles `image` in a new optional `output` array, dropped from the entry when unchecked;
- **识图 (Image understanding)** toggles a new optional `capabilities.imageUnderstanding` marker and — because a model that reasons about image content must receive the image — keeps `image` in `input` too.

Generation stays independent of input: a model that draws images need not accept them, and no combination is forced. The two input-side checkboxes are independent controls; the stored `input` is derived from both, so unchecking understanding alone leaves image input in place until the image-input box is unchecked too. The DeepSeek editor renders no capability checkboxes: its wire route is text-only with a note policy the adapter hardcodes, so a checkbox would declare something the adapter ignores.

The harness channel widens alongside: `LlmModelInfo` gains `outputModalities` and a merge-extensible `capabilities` list (`LlmModelCapabilityMap`, today `image-understanding`), both validated against compile-time drift-gated vocabularies and detached in `LlmRuntime.listModels`/`resolveModelInfo` like `imagePolicy`. The pi-ai adapter resolves the new entry fields into a side table on the resolved profile — pi-ai's vendored `Model` type cannot carry them, so they ride beside `configuredMaxTokens` — and passes them through `LlmModelInfo`. The session-model wire (`ModelCatalogModel`) carries `inputModalities`/`outputModalities`/`capabilities`, and `ui-model-selection` renders small badges for declared claims; a text-only model badges nothing.

## Alternatives considered

- **A provider-scoped reasoning control.** Rejected for the same reason the original note rejected it: effort is a per-model capability and models under one provider disagree, so a provider-level value would be rejected by some models.
- **Capability flags as flat booleans on `LlmModelInfo`.** Rejected — the merge-extensible map keeps a plugin's added capability typed at the seams; flat booleans would need a field per capability and a widening convention with no enforcement.
- **Extending pi-ai's `Model` with the new fields.** Rejected — pi-ai is vendored; the resolved-profile side table (the `configuredMaxTokens` precedent) carries them without forking the dependency.
- **Making 识图 force the 图片输入 checkbox on.** Rejected — the checkboxes stay independent controls; understanding implies image input only at the storage level, which is what the derived `input` array expresses.
- **A checkbox-only editor without the raw text field.** Rejected — custom wire spellings are a real deployment need; the Advanced fold preserves them without crowding the primary surface.

## Consequences

- Reasoning-effort editing is now one checkbox per level with protocol-default spellings, while the Advanced fold keeps arbitrary wire spellings working; the stored format is unchanged.
- DeepSeek models can declare per-model reasoning subsets; absent declarations keep the route-level behavior byte-for-byte.
- Capability claims are declarative and advisory: the harness exposes them for selectors and badges, and this adapter's text seam never invokes image generation, so nothing beyond the declaration rides on `output` or `capabilities`.
- The `LlmModelInfo` and `ModelCatalogModel` surfaces widen; plugins that widen the modality or capability vocabularies must extend the runtime gates in `LlmRuntime` alongside the type-level maps.
- The only-off declaration is refused both client-side and at adapter resolution in favor of `false`, matching the pre-existing pi-ai rule.
