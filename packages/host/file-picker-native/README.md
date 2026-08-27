# @deepseek-ai/dsh-host-file-picker-native

English | [中文](README.zh.md)

The native backend of the [`file-picker`](../file-picker/README.md) seam: it registers `ctx.filePicker` with the `native` capability and opens one OS file chooser on the host display per pick. macOS uses `osascript` (`choose file`, with `multiple selections allowed` for multi-select); Linux uses Zenity (`--file-selection --multiple`) with a KDialog fallback. Every platform command is shell-free and runs through the injectable `NativeCommandRunner`, and each resolves newline-separated absolute paths back to the caller.

Windows is deliberately unsupported for now — the koffi `IFileOpenDialog` file multi-select conversation is its own increment — and fails loud (`native file picker is unsupported on win32`) instead of pretending to pick.

## Model Experience

None, as the native backend opens the host OS chooser; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **win32 unsupported** — Windows selection fails loud until the `IFileOpenDialog` file multi-select conversation is implemented (mirroring the directory picker's existing koffi driver).
- **Only viable at the host screen** — remote deployments have no display to open a chooser on, so this backend is composed only where an operator sits at the host.