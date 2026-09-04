---
description: "The native backend of the file-picker seam: registers ctx.filePicker with the native capability and opens one OS file chooser per pick on the host display via osascript or Zenity (with a KDialog fallback)."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-file-picker-native

English | [中文](README.zh.md)

## Summary

The native backend of the [`file-picker`](../file-picker/README.md) seam: it registers `ctx.filePicker` with the `native` capability and opens one OS file chooser on the host display per pick. macOS uses `osascript` (`choose file`, with `multiple selections allowed` for multi-select); Linux uses Zenity (`--file-selection --multiple`) with a KDialog fallback. Every platform command is shell-free and runs through the injectable `NativeCommandRunner`, and each resolves newline-separated absolute paths back to the caller. Windows is deliberately unsupported for now and fails loud instead of pretending to pick.

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

Compose the package into a Host composition next to the [`file-picker`](../file-picker/README.md) seam; it registers the concrete service implementation and makes `ctx.filePicker` resolvable.

### When to choose it

Choose this package when the Host has an operator at the console and must present a native OS file chooser. Skip it for a remote deployment with no display, or when `locateByName` is sufficient for the browser-drag case; a Windows host remains unsupported until the `IFileOpenDialog` driver lands.

### Minimal configuration

No mount: the package registers the native implementation into a composition. The command runner is injectable, so tests substitute a fake runner rather than invoking a real chooser.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers `ctx.filePicker` with the `native` capability object returned by the seam's `capability()`. macOS invokes `osascript` (`choose file`, with `multiple selections allowed` for multi-select); Linux invokes Zenity (`--file-selection --multiple`) with a KDialog fallback. Every platform command is shell-free and runs through the injectable `NativeCommandRunner`, so no shell interpolation touches the selected paths. Each pick resolves newline-separated absolute paths back to the caller; Windows is deliberately unsupported for now — the koffi `IFileOpenDialog` file multi-select conversation is its own increment — and fails loud (`native file picker is unsupported on win32`) instead of pretending to pick.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [File-picker seam](../../../packages/host/file-picker/README.md)
- [Directory picker seam](../../../packages/host/directory-picker/README.md)
- [Web client architecture](../../../docs/subsystems/web-client.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as the native backend opens the host OS chooser; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **win32 unsupported** — Windows selection fails loud until the `IFileOpenDialog` file multi-select conversation is implemented (mirroring the directory picker's existing koffi driver).
- **Only viable at the host screen** — remote deployments have no display to open a chooser on, so this backend is composed only where an operator sits at the host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the native picker adapter owns no cross-plugin runtime relation.
