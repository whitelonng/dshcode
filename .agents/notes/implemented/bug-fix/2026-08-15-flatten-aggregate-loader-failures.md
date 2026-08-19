# Agent Note: Flatten aggregate loader failures in boot diagnostics

Status: implemented

English | [中文](2026-08-15-flatten-aggregate-loader-failures.zh.md)

## Problem

The Loader applies an entry group transactionally and, when several rows fail, folds the individual failures into one `AggregateError` whose own message (`loader entries failed to apply`) names none of them. `boot()` rendered only the caught error's message plus the deepest cause stack, so a multi-row startup failure printed an unactionable diagnostic, and the desktop recovery dialog's name-matching attribution found no installed plugin name in the text, falling back to "无法确定是哪个插件导致启动失败". `mountPreset` already flattened the same shape for preset mounts with a private helper, so the aggregate was rendered two different ways.

## Decision

`dsh-app-boot` exports `formatLoaderFailure`, the canonical renderer: one line per distinct error message, every `AggregateError` expanded into its individual causes, and a cause whose message its parent already embeds (the Loader's entry-wrap errors embed their cause) not repeated. `boot()` builds its `plugin tree failed to load` detail from it, so every failed row names its id and module. `dsh-agent-presets` imports the shared renderer instead of its private `mountDetail`, adding `dsh-app-boot` as a workspace peer dependency.

## Alternatives considered

**Render through the shared `errorChain` renderer.** Rejected because `dsh-app-boot` has no `dsh-llm` peer and adding the whole LLM capability stack as a boot-glue dependency for one diagnostic is the wrong edge, and because `errorChain`'s single-line `outer: inner [m1; m2]` form buries several row failures in one unwrappable line — the boot diagnostic and the desktop recovery dialog want one line per failing row.

**Keep the two renderers separate.** Rejected because the Loader's aggregate shape is one contract and one canonical renderer keeps both surfaces' diagnostics in sync; the private helper also lacked the cause-chain walk and embed-aware deduplication the boot diagnostic needs.

**Extract the renderer into a new zero-dependency util package.** Rejected because a fifteen-line function with two consumers does not justify a new package's manifest, invariant, README, and aggregate registration; `dsh-app-boot` already owns the boot diagnostic this fixes.

**Have the desktop shell re-parse `AggregateError.errors` itself.** Rejected because that fixes only the dialog while the CLI and every other `boot()` surface still print the unnamed aggregate.

## Consequences

A multi-row startup failure prints one named line per failed row instead of only "loader entries failed to apply", and the desktop recovery attribution finds installed plugin names in the message. Preset mount failures keep naming every row through the same renderer. The boot unit suite pins both row names in a multi-failure rejection; the existing single-failure and deepest-stack pins are unchanged.

## Related

[Render error cause chains at every diagnostic boundary](../../implemented/bug-fix/2026-07-20-error-cause-chain-diagnostics.md) owns the generic cause-chain renderer; this note adds the Loader-aggregate-specific one-line-per-row form at the boot and preset-mount boundaries only.
