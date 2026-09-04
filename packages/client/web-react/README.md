---
description: "Shell-side React glue for the slot terminal design: the SlotRenderer implementation the shell installs into the runtime SlotRegistry, the framework-wired SessionProvider seat, the bindSnapshotSelector hook constructor, and the chain-slot outlet rendering."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-web-react

English | [中文](README.zh.md)

## Summary

Shell-side React glue for the slot terminal design. `createSlotRenderer` is the SlotRenderer implementation the shell installs into the runtime SlotRegistry; `SessionProvider` is the framework-wired render prop injected as a standard seat to entries declaring session-scope children; `bindSnapshotSelector` is the one hook constructor, where hosts and engines traffic in bare observable sources and every hook binds cached per source; `useInvoke` drives the connection's invoke path. Chain-slot outlets run the registered selectors in chain order at render time and mount only the elected entry. The snapshot-store engine and `defineStore` live in the runtime; business plugins depend on `ui-slots` types only, never on this package.

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

The shell composes this package as part of the client assembly; business plugins never import it directly.

### When to choose it

Choose this package when implementing a slot terminal where the harness must bind bare observable sources into React render props. Skip it for a static component library that carries no ctx↔React integration, where `ui-primitives` gives the plain component exports instead.

### Minimal configuration

No mount: the package registers nothing into a composition. The shell installs `createSlotRenderer` into the runtime SlotRegistry and declares the SessionProvider seat through the standard client assembly.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`createSlotRenderer` builds the SlotRenderer the shell registers into the runtime SlotRegistry. `SessionProvider` is a framework-wired render prop that also serves as a standard seat for entries declaring session-scope children. `bindSnapshotSelector` is the single hook constructor — hosts and engines hand it bare observable sources, and it binds each hook once per source with caching. Chain-slot outlets evaluate the registered selectors in chain order at render time and mount only the elected entry, its select return joining the props as `matched`; the `renderSlotChain` binding is per-entry cached like `renderSlot`. The snapshot-store engine and `defineStore` stay in the runtime rather than here, so the package carries no store registry of its own.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web client architecture](../../../docs/subsystems/web-client.md)
- [Slots reference](../../../docs/subsystems/slots.md)
- [Client store primitives](../../../packages/client/store/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as the ctx↔React machinery runs entirely in the browser; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The persist middleware corrupts primitive-state stores** — it object-spreads state on save, so a `SnapshotStore<string>` round-trips as a character map; the engine hand-rolls persistence instead (see `attachPersistence`).
- **`UseSession` is deliberately wide (`object` snapshot)** — the dependency direction (runtime → web-react, never the reverse) keeps the real `ConversationSnapshot` type out of reach; session-slot consumers narrow once at their boundary.
- **`renderSlot` is the only rendering form** — there is no Suspense integration or per-entry lazy loading.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the React slot machinery owns no cross-plugin mutable relation.
