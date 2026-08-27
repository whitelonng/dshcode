# @deepseek-ai/dsh-host-file-picker

English | [中文](README.zh.md)

The web GUI host's native file picker is a capability seam. The abstract `FilePicker` service (`ctx.filePicker`) is its Service Definition; `capability()` returns the single `native` interaction (`{ kind: 'native', pickFiles({ multiple }, signal) }`), which opens one OS chooser on the host display and resolves the selected absolute paths back to the caller — or `null` when the operator cancels. Unlike [`directory-picker`](../directory-picker/README.md), there is no browse twin: a remote client has no display to open a file chooser on, so the backend is native-only. The capability object must be stable for the service lifetime; a future backend declaration-merges its shape into `FilePickerCapabilities` instead of editing this package.

`locateByName` (the `./locate` subpath) is the complement to path selection: a browser drag delivers only a file's `name`, never its host path, so the host walks a directory tree for exact-basename matches and returns absolute paths — no bytes staged, no workspace write. An optional `systemSearch` tier appends wider results only when the walk underfills its bound. Non-native selection cannot leak a real path to the browser; `pickFiles` is the one path that does.

## Model Experience

None, as the seam serves the GUI host's native file selection; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Native-only** — no remote-client interaction shape; a composition where no host display exists must hide the pick affordance rather than fail.
- **System-wide tier is caller-supplied** — `locateByName` walks the workspace tree itself and accepts a `systemSearch` delegate for anything wider (spotlight/`find`), so its coverage and cost are the caller's policy.