# Python 贡献者工作流

[English](development.md) | 中文

根据所需的贡献者成果选择工作流：构建运行时产物、验证 SDK、从源码运行或构建分发包。包行为分别见 [SDK 参考](sdk/README.md) 和[运行时载体参考](sdk-runtime/README.md)。

## 构建运行时产物

各平台可执行文件是构建产物，不检入 git。请在仓库根目录运行构建：

```sh
pnpm install
pnpm exec tsx scripts/build-exe-for-python-sdk.ts
```

所需 `lib/` 产物已存在时使用 `--skip-build`；如需选择平台，请使用 `--targets=node24-linux-x64,node24-linux-arm64,node24-macos-arm64`。产物写入 `dist-exe/`，脚本会将所选载体同步到 `python/sdk-runtime/`。macOS 构建还会同步 `node-pty` 所需的配套 spawn 辅助程序。

## 验证 SDK

请将虚拟环境放在 `python/` 之外，安装测试组，然后运行 Python 测试套件：

```sh
export UV_PROJECT_ENVIRONMENT="$PWD/tmp/py-sdk-venv"
uv sync --project python/sdk --group test
uv run --project python/sdk pytest
```

`python/sdk/tests/test_bundled_runtime.py` 会运行可用的内置载体；某个载体的产物尚未构建时，会跳过该载体。仓库级测试政策见 [测试](../docs/testing.md)。

交互式冒烟测试需要环境变量或仓库根目录 `.env` 中存在 `DEEPSEEK_API_KEY`：

```python
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness() as harness:
    print(harness.run("say hi").final_response)
```

## 针对 Node 源码运行

仓库贡献者可以选择以下任一开发载体：

- 设置 `DSH_RUNTIME_MODE=node`，在系统 Node `>=22.19` 上使用已构建的 Node 载体。构建脚本会刷新该载体，但分发物绝不会包含或自动选择它。
- 将仓库根目录设为 `cwd`，并设置 `launch_args_override=("./node_modules/.bin/tsx", "packages/examples/jsonrpc-demo/src/bin.ts")`，以运行未构建的 TypeScript 源码。默认配置不合适时，请提供 `cordis=...`。

完整的源码模式调用见 `python/sdk/tests/manual_sdk_agent_smoke.py`。

## 构建分发包

根目录 `package.json` 的版本是两个 Python 分发包的权威版本。暂存脚本会将该版本注入两个 wheel 包，并将 SDK 固定到同版本的 `deepseek-harness-runtime-bin`。

纯 SDK wheel 包只需构建一次；每个原生平台分别构建一个运行时 wheel 包：

```sh
version="$(node -p "require('./package.json').version")"
python scripts/build-python-release.py --package sdk --output-dir dist-python
python scripts/build-python-release.py --package runtime --platform macos-arm64 --runtime-exe dist-exe/dsh-jsonrpc-agent-pkg-macos-arm64 --output-dir dist-python
pip install --find-links dist-python deepseek-harness-sdk=="$version"
```

运行时分发包仅提供 wheel 包。发布流水线会连同纯 SDK wheel 包一起发布三个平台 wheel 包：Linux x64、Linux arm64 和 macOS 14 或更高版本的 arm64。只有与仓库版本匹配时，才接受 `python-v<repository-version>` 标签；`0.0.1-rc.1` 之类的仓库预发布版本在 wheel 包文件名和元数据中使用规范化的 PEP 440 写法，例如 `0.0.1rc1`。

## 验证候选发行版

为拉取请求添加 `python-release-dry-run` 标签，或手动运行 GitHub 的 `Release (Python)` 工作流并设置 `publish=false`，即可构建全部四个 wheel 包，在 Python 3.10 和 3.14 上安装 Linux 发行集合，检查精确文件名和元数据，执行 PyPI 默认单文件大小限制，并保留一份带 SHA-256 哈希的汇总产物。两条路径都没有注册表凭据，拉取请求运行无法进入任何发布作业。

公开发布从私有自动化仓库运行；包元数据指向独立的只读公开源码镜像，该镜像不运行发布 Actions。私有仓库把仓库变量 `PYPI_PUBLISHER_REPOSITORY` 定义为自身的 `owner/name`，并且只在有意发布期间把 `PUBLIC_PYPI_RELEASE_ENABLED` 从 `false` 改为 `true`。

独立的运行时与 SDK 作业使 SDK 上传失败后可以继续执行，而无需重新发送不可变的运行时文件。只有工作流从配置的发布仓库、匹配的 `python-v*` 标签运行，且受保护的 `pypi-runtime` 和 `pypi` 环境分别批准运行时与 SDK 作业时，才接受 `publish=true`。PyPI Trusted Publishing 仍会提供短期 OIDC 凭据，但公开 attestation 会披露私有发布仓库身份，因此将其禁用。
