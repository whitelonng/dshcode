# Agent Note: Reasoning-effort declarations for third-party models

Status: implemented

English | [中文](2026-08-14-third-party-model-reasoning-efforts.zh.md)

> Scope: the model-settings form surface that lets a hand-declared third-party model offer thinking levels. The pi-ai adapter already supported per-model `reasoningEfforts` declarations; this note adds the UI that writes them.

## Problem

The composer's model picker offers reasoning-effort levels only for models that carry reasoning metadata (`model.reasoning.efforts`). A hand-declared third-party model — any OpenAI-compatible route added from Settings — carried no such metadata unless a profile author hand-edited `settings.yaml`, because the model form exposed only id/name/contextWindow/maxTokens. Users could not make a third-party API model's thinking level adjustable from the UI.

## Decision

The pi-ai model row's disclosure (in `ui-settings-models`' `ModelListEditor`, the shared editor behind both the pi-ai card and the custom-provider card) gains a **推理等级 (Reasoning efforts)** text field plus a **禁用推理 (Disable reasoning)** checkbox:

- The text spells the declaration as `level: wire-spelling` pairs, comma-separated, with `off` allowed to stand alone (`off:` or bare `off` — pi-ai's empty-off spelling, sent as `thinking: {type: "disabled"}` on the deepseek dialect or omitted elsewhere). Levels come from pi-ai's canonical set (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`).
- Parsing lives in a new `reasoning-efforts.ts` module shared by the editor and the validation guard. Unreadable text parks a string sentinel (`INVALID_EFFORTS`) in the draft — the same shape as the `NaN` sentinel capacities use — and `validateDeepSeekModels` refuses it before any write, so a typo never reaches the profile.
- The checkbox writes `false` (disable reasoning); unchecking clears the declaration. An empty field leaves the model's reasoning capability to the installed catalog (or absent).
- The declaration lands in the same `providers.<route>.models[].reasoningEfforts` the adapter already reads, via the existing `settings.mutate` replace-array path; no host-side or adapter change was needed.

## Verification

New unit tests cover the parse/format/validation module (empty text, `off` spellings, unknown levels, empty non-off spellings, sentinel rejection). The components suite renders `ModelListEditor` with real local state and asserts the draft receives parsed declarations, the invalid sentinel, and the disable/clear toggle round-trip. The models-settings web replay stays green against the rebuilt bundle (the disclosure renders nothing while collapsed, so goldens are unchanged).

## Alternatives considered

**A provider-scoped reasoning control on the card.** Rejected — the existing card comment documents why: effort is a per-model capability and models under one provider disagree about levels, so a provider-level value would be rejected by some models. The per-model disclosure matches the picker's own per-model offer.

**A structured multi-level editor (one input per level).** Rejected — the text spelling is one field like the capacity fields, validates with a single localized message, and round-trips exactly; a grid of seven inputs would crowd the disclosure for the same capability.

**Writing the declaration through a new wire endpoint.** Rejected — the settings-mutate path already carries arbitrary `models` entries verbatim; the form only needed to produce the value.

## Consequences

- A third-party model's thinking levels become adjustable entirely from Settings: declare `high: high, max: ultra`, save, and the composer's model picker offers those levels for that model, dispatching the declared wire spelling.
- Unreadable declarations fail loud before any write; existing models and catalog entries are untouched by an empty field.
- The form remains one field wider per model row; the disclosure keeps it out of the collapsed view.
