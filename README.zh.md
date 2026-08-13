# DSHCode

[English](README.md) | 中文

DSHCode 是面向 DeepSeek 官方开源项目 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的社区 Electron 桌面端配套应用。它把上游 Web UI 和插件运行时打包成可一键打开的 macOS 与 Windows 应用，安装版用户无需准备 Node.js 或操作 CLI（命令行界面）。

<p align="center"><img src="apps/desktop/assets/icon.svg" alt="DSHCode application icon" width="180"></p>

<p align="center"><img src="assets/readme/dshcode-dark.png" alt="DSHCode dark theme" width="49%"> <img src="assets/readme/dshcode-light.png" alt="DSHCode light theme" width="49%"></p>

## 下载

请从 [GitHub Releases](https://github.com/whitelonng/dshcode/releases) 下载 macOS Apple Silicon、macOS Intel 和 Windows x64 安装包。预览版安装包尚未进行代码签名或公证，因此 macOS Gatekeeper 与 Windows SmartScreen 可能在首次启动前发出警告。

## 运行

安装 DSHCode 安装包后，从 macOS“应用程序”文件夹或 Windows“开始”菜单打开 `DSHCode`。应用会自行启动和停止内置 Web profile；安装版用户无需运行终端命令。

### 从源码运行

开发者仍可从仓库源码运行上游 Web 入口：

```sh
git clone https://github.com/whitelonng/dshcode.git
cd dshcode
pnpm install
pnpm run build
pnpm dsh web
```

命令会打印本地 Web UI 地址。详见 [Web UI 指南](docs/user/guide/index.md)。

## 桌面应用

打开 DSHCode 时，应用会启动内置的 Harness Web profile，并在经过安全加固的 Electron 窗口中显示。桌面外壳刻意保持精简；产品行为和 Web UI 仍由上游包提供，因此后续可以继续集成上游更新，而不必维护第二套界面。

架构、平台构建目标、打包方式和当前限制详见[桌面应用指南](apps/desktop/README.md)。

### 本地服务与端口

应用每次启动时都会在 Electron 主进程内启动一个 HTTP 服务。该服务只绑定 `127.0.0.1`，并让操作系统分配一个可用的临时端口，因此不会占用固定端口，通常也不会与其他本地服务冲突。DSHCode 只允许一个应用实例，只加载其自身的精确回环地址；进程退出前会先释放 Harness 树，所以关闭应用也会停止服务并释放端口。

### 构建桌面安装包

```sh
git clone https://github.com/whitelonng/dshcode.git
cd dshcode
pnpm install
pnpm run desktop:dist
```

构建产物写入 `.artifacts/desktop/release/`。名为 `Desktop` 的 GitHub Actions 工作流会构建 macOS Apple Silicon、macOS Intel 和 Windows x64 安装包；`desktop-v*` tag 会把完整构建矩阵及 SHA-256 校验和发布到 GitHub Releases。

## 项目定位

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的官方开源插件式 agent harness（智能体框架）。DSHCode 作为桌面端配套发行版参与其插件生态，并使用 `dsh-plugin` 和 `deepseekharness-plugin` 仓库标签便于检索。项目保留上游包名、版权声明、架构、文档和 `upstream` Git 远程地址，以便正确归属来源并继续合并上游变更。

DSHCode 是独立的社区项目。除非 DeepSeek 明确授权，否则它不代表 DeepSeek 官方发行、背书或认证。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

## 开发

请先阅读[开发指南](docs/development.md)、[架构文档](docs/architecture.md)和[桌面应用指南](apps/desktop/README.md)。面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证与品牌

源码继续使用上游 [MIT 许可证](LICENSE)。再次分发时必须保留 DeepSeek 的版权与许可声明；内置第三方软件及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，桌面安装包会同时附带这两个文件。

MIT 软件许可证本身不等于获得 DeepSeek 商标或 Logo 的 DSHCode 品牌使用许可。DeepSeek 的[用户协议](https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html)（[中文版](https://cdn.deepseek.com/policies/zh-CN/deepseek-terms-of-use.html)）保留了这些品牌标识的相关权利。DSHCode 发行版使用独立应用图标；内嵌 Harness 界面保留的上游身份标识及官方 `powered by dsh` 署名只用于说明兼容关系，不代表官方背书。
