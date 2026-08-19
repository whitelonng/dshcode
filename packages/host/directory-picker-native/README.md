# @deepseek-ai/dsh-host-directory-picker-native

English | [中文](README.zh.md)

The **native-OS-chooser backend** of the [directory-picker seam](../directory-picker/README.md): `NativeDirectoryPicker` registers `ctx.directoryPicker` with the `native` capability, whose `pick(signal)` opens one native chooser per call and resolves the chosen absolute path (`null` on cancel). Platform tools run without a shell: `osascript` on macOS and Zenity with a KDialog fallback on Linux; the caller's abort terminates the native process. Windows opens the modern `IFileOpenDialog` in a spawned child process — a koffi-driven COM conversation on the child's main thread with the best thread DPI awareness the host accepts (per-monitor-v2 first), aborted by posting `WM_CLOSE` to the dialog thread. The controlled child sets Electron's [`ELECTRON_RUN_AS_NODE`](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node) mode so a packaged host runs the worker as Node instead of relaunching its application; this setting does not enter the parent process or require user configuration. Only viable when the operator sits at the host's display — remote deployments compose [`-browse`](../directory-picker-browse/README.md) instead. The command boundary (`DirectoryPickerRunner`) and platform facts are injectable. The shared no-shell subprocess runner lives in [`dsh-native-command`](../../util/native-command/README.md).

**Dual-face package**: the browser half (`./client`) registers a renderless flow occupant into [ui-workspace's](../../client/ui-workspace/README.md) two directory-flow holes — each `open` request drives `host.pickDirectory` and reports the one outcome (picked path / cancel / failure) through the hole's owner conversation. Both directory-flow declarations must be live before either contribution installs. One cordis.yml row therefore composes both sides of the native interaction; the client carries no capability-kind branching, and mounting a second flow package fails at load (the holes are `single` kind).

## Model Experience

None, as the backend serves the GUI host's directory selection; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Linux requires desktop tooling** — with neither Zenity nor KDialog installed, `pick` rejects with an actionable error; it does not fall back to a typed-path prompt (the browse backend is that fallback at the composition level).
- **Windows has no mechanism fallback** — the child-process picker through packaged koffi is the only native tier, so a COM refusal or dialog crash surfaces the failure. The browse backend remains the fallback at the composition level.
- **Windows source-plane launch depends on native TypeScript stripping** — the source worker is executed directly by Node on the repository engines range (`^22.19.0 || >=24.0.0`), so its package-local dependency graph must remain erasable TypeScript with type-only relative imports. The source child also removes inherited `NODE_OPTIONS` flags that disable native type stripping (`--no-experimental-strip-types` and `--no-strip-types`); unrelated options are preserved. The packaged CJS worker does not have this source-plane dependency.
