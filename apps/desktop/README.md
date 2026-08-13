# DSHCode desktop application

English | [中文](README.zh.md)

`@dshcode/desktop` is the Electron shell that turns the existing DeepSeek Harness Web UI into an installable macOS and Windows application. It does not fork or duplicate the renderer UI.

## Runtime model

The Electron main process calls the shared `@deepseek-ai/dsh/profile-boot` entry and boots the existing `web` profile in-process. No CLI process or separately managed server child is spawned. The BrowserWindow opens the address reported by the activated WebServer service only after the complete Harness tree has booted.

Packaged Electron does not expose the Node loader internals required by Cordis HMR. The desktop launcher therefore disables live watching of the profile-level and home-level `cordis.patch.yml` files; their contents are still loaded at startup, and ordinary settings managed by the Web UI keep their own live behavior. Restart DSHCode after manually editing either patch file.

## Security and lifecycle

- The WebServer binds only to `127.0.0.1` with port `0`, which asks the operating system to atomically select an available ephemeral port.
- Electron permits one DSHCode instance. A second launch focuses the existing window instead of starting another Harness tree or listener.
- The renderer uses context isolation, disables Node integration, enables the Chromium sandbox, denies permission requests, and may navigate only within the exact application origin. HTTPS links open in the system browser; other cross-origin targets are blocked.
- Native quit requests first await the Harness shutdown controller. The WebServer disposer closes normal and upgraded sockets, then Electron exits and the ephemeral port becomes reusable.

## Build

From the repository root, install the declared Node.js and pnpm versions, then run:

```sh
pnpm install
pnpm run desktop:package
```

`desktop:package` builds the repository and creates an unpacked application for the current platform. `desktop:dist` creates the configured distributable targets. Output is written to `.artifacts/desktop/release/`.

### Platform targets

```sh
pnpm --filter @dshcode/desktop run dist:mac:arm64
pnpm --filter @dshcode/desktop run dist:mac:x64
pnpm --filter @dshcode/desktop run dist:win:x64
```

The `Desktop` GitHub Actions workflow runs the same targets on native macOS and Windows runners. Cross-compiling the Windows installer on macOS is not the supported verification path.

## Packaging

The staging script creates a production-only `pnpm deploy` directory outside the source workspace. Before deployment it verifies that every required workspace peer is a direct runtime dependency, preventing delayed package-resolution failures after installation. The full source workspace installation is restored after staging because `pnpm deploy` records its production filter in shared workspace state.

The application uses unpacked resources because the Harness profile fallback creates real package symlinks. The distribution includes the upstream MIT license and generated third-party notices. Electron is treated as a shipped runtime dependency even though electron-builder requires it to remain a development dependency in the source manifest.

## Current limitations

- Packages are unsigned unless the build environment supplies platform signing credentials. macOS Gatekeeper and Windows SmartScreen may warn about unsigned local builds.
- Automatic updates are not configured.
- Public distribution with the upstream DeepSeek icon or other brand assets requires separate permission; see the repository [license and branding notice](../../README.md#license-and-branding).
