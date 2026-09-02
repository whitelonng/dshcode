---
description: "The web GUI host's native file picker capability seam: the abstract FilePicker Service Definition, its single native interaction shape, and the locateByName complement that resolves browser-dragged file names to host absolute paths."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-file-picker

English | [中文](README.zh.md)

## Summary

The web GUI host's native file picker is a capability seam. The abstract `FilePicker` service (`ctx.filePicker`) is its Service Definition; `capability()` returns the single `native` interaction (`{ kind: 'native', pickFiles({ multiple }, signal) }`), which opens one OS chooser on the host display and resolves the selected absolute paths back to the caller — or `null` when the operator cancels. `locateByName` (the `./locate` subpath) complements path selection: a browser drag delivers only a file's `name`, so the host walks a directory tree for exact-basename matches and returns absolute paths. Unlike the directory picker, there is no browse twin: a remote client has no display to open a chooser on, so the backend is native-only.

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

Compose the package into a Host composition; the service is injectable as `ctx.filePicker` and a call opens the native OS chooser on the host display.

### When to choose it

Choose this package when the Host must resolve a real host path for an operator at the console. Skip the pick when no host display exists — a remote client has no chooser to open — and hide the pick affordance rather than fail; use `locateByName` for the browser-drag case where only the basename is available.

### Minimal configuration

No mount: the package provides the Service Definition and its capability shape. The native backend (the [`file-picker-native`](../file-picker-native/README.md) package) registers the implementation into a composition.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Service Definition declares `FilePicker` and the capability object its providers return. `capability()` returns the single `native` interaction shape, opened on the host display and resolving selected absolute paths back to the caller (or `null` on cancel). The capability object must be stable for the service lifetime; a future backend declaration-merges its shape into `FilePickerCapabilities` instead of editing this package. `locateByName` walks a directory tree for exact-basename matches and returns absolute paths — no bytes staged, no workspace write; an optional `systemSearch` tier appends wider results only when the walk underfills its bound. Non-native selection cannot leak a real path to the browser; `pickFiles` is the one path that does.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Directory picker seam](../../../packages/host/directory-picker/README.md)
- [Native file-picker backend](../../../packages/host/file-picker-native/README.md)
- [Web client architecture](../../../docs/subsystems/web-client.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as the seam serves the GUI host's native file selection; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Native-only** — no remote-client interaction shape; a composition where no host display exists must hide the pick affordance rather than fail.
- **System-wide tier is caller-supplied** — `locateByName` walks the workspace tree itself and accepts a `systemSearch` delegate for anything wider (spotlight/`find`), so its coverage and cost are the caller's policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
