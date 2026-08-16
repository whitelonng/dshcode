# DSHCode

English | [中文](README.zh.md)

DSHCode is a free, open-source desktop AI agent app for macOS and Windows. It wraps the official open-source [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI and plugin runtime in a single installable Electron application — no Node.js, no terminal, no CLI required.

<p align="center">
[![Release](https://img.shields.io/github/v/release/whitelonng/dshcode?style=flat-square&label=release)](https://github.com/whitelonng/dshcode/releases)
[![License](https://img.shields.io/github/license/whitelonng/dshcode?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-4D6BFE?style=flat-square)](https://github.com/whitelonng/dshcode/releases)
[![Downloads](https://img.shields.io/github/downloads/whitelonng/dshcode/total?style=flat-square)](https://github.com/whitelonng/dshcode/releases)
[![Powered by dsh](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
</p>

<p align="center"><img src="apps/desktop/assets/icon.svg" alt="DSHCode application icon" width="180"></p>

<p align="center"><img src="assets/readme/dshcode-dark.png" alt="DSHCode dark theme" width="49%"> <img src="assets/readme/dshcode-light.png" alt="DSHCode light theme" width="49%"></p>

## Features

DSHCode inherits the full DeepSeek Harness capability set and adds a one-click desktop experience.

**Agent core** — Plugin-based harness with bash, filesystem, web search/fetch, terminal, LSP, and subprocess tools; sandboxing and per-action approval prompts.

**Interactive UI** — GenUI cards rendered inline: charts, tables, quizzes, 3D scenes, diagrams, forms, and progress views.

**Skills** — Installable skill catalog that gives the agent specialized workflows — research, documentation writing, visual tools, and more.

**Orchestration** — Subagents for parallel delegation and workflows that fan work out across many agents with structured phases.

**Long-running work** — Plan mode to review and approve before execution, persisted goals that continue across rounds, and resumable sessions.

**Model experience** — DeepSeek models through the official API; session logs record everything a model sees so any run can be reconstructed.

**Model control** — Per-provider reasoning effort (off to max), maximum output tokens, and multimodal capability switches for image input, generation, and recognition.

<p align="center"><img src="assets/readme/readme-model-config.png" alt="Custom provider model reasoning level and multimodal capabilities" width="49%"> <img src="assets/readme/readme-thinking-level.png" alt="Adjust reasoning strength for third-party APIs" width="49%"></p>

**Personalization** — Theme and skin collection, selection-annotation workflow, command shortcuts, and an English/Chinese interface.

**Plugin management** — Install plugins from npm or a Git repository, check for updates, and enable or disable each plugin.

<p align="center"><img src="assets/readme/readme-plugin-manager.png" alt="Plugin download, update, and management" width="49%"></p>

**Recovery** — A plugin that fails to load is reported with its diagnostics: disable that plugin, start in safe mode, or let the agent repair it with the failure context attached.

<p align="center"><img src="assets/readme/readme-safe-mode.png" alt="Disable the failing plugin or start in safe mode" width="49%"> <img src="assets/readme/readme-agent-repair.png" alt="Let the agent repair a broken plugin" width="49%"></p>

<p align="center"><img src="assets/readme/readme-plugin-failure.png" alt="Plugin failure notification with diagnostics" width="60%"></p>

**Archives** — Search archived conversations and restore or permanently delete them.

<p align="center"><img src="assets/readme/readme-archives.png" alt="Archive management with search, restore, and delete" width="60%"></p>

**Extensibility** — New capabilities install without touching the app bundle.

**Desktop integration** — Tray icon, native notifications, one instance, and a hardened Electron window.

<p align="center"><img src="assets/readme/readme-notifications.png" alt="Native OS notifications" width="60%"></p>

See the [Web UI guide](docs/user/guide/index.md) for a walkthrough and the [desktop application guide](apps/desktop/README.md) for architecture, platform targets, and current limitations.

## Download

| Platform | Package |
|---|---|
| macOS Apple Silicon | [DSHCode-*-macos-arm64.dmg](https://github.com/whitelonng/dshcode/releases) |
| macOS Intel | [DSHCode-*-macos-x64.dmg](https://github.com/whitelonng/dshcode/releases) |
| Windows x64 | [DSHCode-*-win-x64.exe](https://github.com/whitelonng/dshcode/releases) |

Every release publishes SHA-256 checksums (`SHA256SUMS.txt`) next to the packages.

Preview packages are not code-signed or notarized, so macOS Gatekeeper and Windows SmartScreen may warn before first launch. The software is safe; the warning exists because the binary lacks a paid signing certificate:

- **macOS**: right-click the app in Finder and choose **Open**, then confirm in the dialog that appears. Alternatively run `xattr -cr /Applications/DSHCode.app` once in Terminal.
- **Windows**: click **More info** on the SmartScreen dialog, then **Run anyway**.

## Quick start

Install a DSHCode package, then open `DSHCode` from the macOS Applications folder or the Windows Start menu. The application starts and stops its bundled Web profile itself; installed users never run a terminal command.

### Run from source

Developers can run the upstream Web entry from a repository checkout:

```sh
git clone https://github.com/whitelonng/dshcode.git
cd dshcode
pnpm install
pnpm run build
pnpm dsh web
```

The command prints the local Web UI address. See the [Web UI guide](docs/user/guide/index.md).

## Desktop application

Opening DSHCode starts the bundled Harness Web profile and displays it in a hardened Electron window. The desktop shell is intentionally small; product behavior and the Web UI remain in the upstream packages so later upstream updates can be integrated without maintaining a second interface.

### Local service and ports

Each launch starts an HTTP service inside the Electron main process. It binds only to `127.0.0.1` and asks the operating system for an available ephemeral port, so it reserves no fixed port and normally cannot conflict with another local service. DSHCode permits one application instance, loads only its exact loopback origin, and disposes the Harness tree before the process exits; closing the application stops the service and releases its port.

### Build desktop packages

```sh
git clone https://github.com/whitelonng/dshcode.git
cd dshcode
pnpm install
pnpm run desktop:dist
```

Artifacts are written to `.artifacts/desktop/release/`. The `Desktop` GitHub Actions workflow builds macOS Apple Silicon, macOS Intel, and Windows x64 packages; a `desktop-v*` tag publishes the completed matrix and SHA-256 checksums to GitHub Releases.

## FAQ

**What is DSHCode?**

DSHCode is a free, open-source desktop app that turns DeepSeek Harness — DeepSeek's plugin-based AI agent framework — into an installable macOS and Windows application with a graphical chat and workspace interface.

**Is DSHCode official DeepSeek software?**

No. DSHCode is an independent community project. It retains upstream package names, copyright, architecture, documentation, and an `upstream` Git remote so changes remain attributable and mergeable, but it is not a DeepSeek release, endorsement, or certification unless DeepSeek grants explicit authorization.

**Do I need Node.js or a terminal?**

No. Installed users get a normal application; Node.js, the CLI, and the terminal are only required for running from source or building packages.

**Why does macOS/Windows show a security warning?**

The preview packages are not code-signed or notarized. This is a certificate cost issue, not a safety issue; see the one-time steps in the Download section.

**Do I need an API key?**

Yes. DSHCode runs DeepSeek models through the official API; add your key once in the application settings.

**Can I extend DSHCode?**

Yes. The built-in plugin installer adds new capabilities without touching the app bundle, and a safe mode disables a crashing plugin so the application still starts.

## Project positioning

DeepSeek Harness (`dsh`) is the official open-source plugin-based agent harness developed by [DeepSeek AI](https://deepseek.com). DSHCode participates in its plugin ecosystem as a desktop companion distribution and uses the `dsh-plugin` and `deepseekharness-plugin` repository topics for discovery.

DSHCode is an independent community project. Unless DeepSeek grants explicit authorization, it is not an official DeepSeek release, endorsement, or certification.

## Development

Start with the [development guide](docs/development.md), [architecture documentation](docs/architecture.md), and [desktop application guide](apps/desktop/README.md). For agents, follow [AGENTS.md](AGENTS.md).

## Acknowledgements

- [LINUX DO](https://linux.do) — This project is continuously shared and discussed in the LINUX DO community.
- [dsh-genui](https://github.com/omdsh-dev/dsh-genui) — Provides the built-in generative UI plugin.
- [dsh-annotation](https://github.com/omdsh-dev/dsh-annotation) — Provides the built-in selection-annotation workflow.
- [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) — Provides the built-in Web UI feature and skin collection.

## License and branding

The source remains available under the upstream [MIT License](LICENSE). Redistribution must retain DeepSeek's copyright and permission notice; bundled third-party software and licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and the desktop package includes both files.

The MIT software license does not by itself grant permission to use DeepSeek trademarks or logos as DSHCode branding. DeepSeek's [Terms of Use](https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html) ([Chinese version](https://cdn.deepseek.com/policies/zh-CN/deepseek-terms-of-use.html)) reserve those brand features. DSHCode distributions use an independent application icon; upstream identity retained inside the embedded Harness interface and the official `powered by dsh` attribution identify compatibility, not endorsement.
