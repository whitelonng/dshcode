# Agent Note: Note image policy lets text-only routes carry image-bearing sessions

Status: implemented

English | [中文](2026-08-16-note-image-policy-text-only-model-selection.zh.md)

## Problem

The describe-image pipeline ([tool README](../../../../packages/vision/tool-describe-image/README.md)) gives DeepSeek's text-only models vision by flattening image content blocks into copyable `[image attachment …]` notes on the DeepSeek wire route, and the host admits image prompts on text-only routes so those notes reach the model. The companion `session.selectModel` gate still assumed every text-only route rejects image content: while a session's history — or its pending inbox — carried images, selecting any DeepSeek model or reasoning effort returned `model-unavailable` ("does not accept image input, but this session already contains images"). A user could chat about attached images, but switching models or thinking levels mid-conversation stranded the session.

The gate's own comment recorded the wrong assumption: "both wire routes reject image content on text-only models". Only the pi-ai route rejects; the DeepSeek route serializes images into notes by design ([multimodal note](../feature/2026-07-22-web-multimodal-image-input-and-durable-attachments.md) records the rejection the fork later deviated from).

## Decision

`LlmModelInfo` gains `imagePolicy: 'note' | 'reject'` — how the adapter carries image content blocks when the endpoint does not accept image input natively. Absent is the conservative negative (`reject`). The DeepSeek adapter declares `note` for every model, cataloged and uncatalogued alike. `LlmRuntime` validates the field (`INVALID_CATALOG` / `INVALID_MODEL_INFO`) and passes it through both metadata queries. `session.selectModel` refuses an image-bearing session only when the target's `inputModalities` explicitly excludes `image` **and** its policy is not `note`; unknown modalities keep their existing admit-and-let-the-adapter-guard behavior.

The policy is route metadata, not a modality claim: DeepSeek still advertises `inputModalities: ['text']`, so tool consumers that gate on native image input (`read_image`) are unaffected.

## Alternatives considered

**Delete the selection gate.** Rejected because a rejecting route (pi-ai text models) would strand the session at request time with no in-product recovery; the gate exists to refuse that selection at the boundary.

**Declare `inputModalities: ['text', 'image']` for DeepSeek models.** Rejected because the endpoint never receives image data; the catalog would advertise vision capability to the model picker and to consumers like `read_image`, and the serializer would flatten whatever they hand over.

**Rewrite image blocks into descriptions inside the plugin.** Rejected because the rewrite happens at `agent/pre-step`, after the session already logged the image and while a queued message can still sit in the pending inbox — the selection gate would keep firing on that race window, and the user's attached image would disappear from the transcript.

## Consequences

Switching DeepSeek models or reasoning efforts now succeeds with durable or pending image content, matching the admission path the describe-image pipeline already relies on. Text-only routes that reject image content remain refused at the selection boundary. The new field rides the generated cordis API catalog; fixtures and adapters that omit it keep the previous conservative behavior.

## Related

- [Web multimodal image input and durable attachments](../feature/2026-07-22-web-multimodal-image-input-and-durable-attachments.md) owns the image content block, the modality metadata, and the original text-only rejection this pipeline deviates from.
- [Atomic Web image admission](../bug-fix/2026-07-29-atomic-web-image-admission.md) owns the serial admission/selection boundary this fix amends.
