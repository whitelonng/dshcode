# Agent Note: GitHub 插件安装改走 codeload tarball 与 GitHub API

Status: implemented

[English](2026-08-15-github-tarball-installs.md) | 中文

## 问题

自研 git 路径（没有 pnpm 的机器）安装任何 GitHub 插件都要 `git clone --depth 1`（120 秒上限）再接 `git ls-remote`（30 秒上限）。GitHub 的 smart-HTTP 克隆在差路由上极易卡死，机器还必须装有 `git` 二进制（Windows 上常见缺失），而插件列表的目录条目全是 GitHub 仓库，每次从列表安装都要付完整克隆成本。安装超时是现场最集中的投诉。

## 决策

**GitHub tarball + API 路径（`src/git-source.ts`）。** `parseGithubUrl` 从规范化 URL 中提取 `owner`/`repo`/`ref`；`normalizeGitUrl` 现在展开 `github:owner/repo#ref` 简写并保留固定引用，`isGitSpec` 接受粘贴进来的 `https://github.com/owner/repo#ref` URL。`installFromGithub` 下载 `https://codeload.github.com/<owner>/<repo>/tar.gz/<ref|HEAD>`——codeload 是不做 git pack 协商的 CDN，`HEAD` 解析默认分支——并用 `tar.x({ strip: 1 })` 解压，布局契约与 npm 路径一致。`githubCommitSha` 经 `https://api.github.com/repos/<owner>/<repo>/commits/<ref|HEAD>` 解析记录的 commit（`HEAD` 同样可用）；环境变量 `GITHUB_TOKEN`/`GH_TOKEN` 可解除未认证核心速率限制（60 次请求/小时，每次安装与每次检查更新各一次查询）。GitHub 安装从此完全不需要 `git` 二进制。

**回退而非静默切换。** GitHub URL 的 tarball 路径失败时，仅当 `git --version` 探测成功才回退到既有浅克隆；没有 git 时 tarball 失败即最终错误。codeload 返回 404（仓库不存在或私有）时两种情况都直接终局——克隆会在同一个不存在上卡死。`gitRemoteHead` 先试 API，API 失败再回退 `git ls-remote`。非 GitHub 托管保持克隆路径逐字节不变。硬超时按慢速、被限流的网络来定（曾观测到 pnpm 的普通 git 克隆在这种网络上约 90 秒完成）：API 30 秒、tarball 300 秒、ls-remote 60 秒、克隆 300 秒。

**镜像前缀与 GUI PATH 的 pnpm 发现。** 受限网络的两项现场跟进：(1) 网关 `Config` 新增可选 `githubMirror`（http(s) URL 前缀，加载时校验并规范化——设置了非 http(s) 值即大声失败），只加在 codeload 与 api.github.com URL 前面；web-app bundle 以 `!!js process.env.DSH_GITHUB_MIRROR` 接入，打包应用从 `~/.dsh/.env` 读取——与 profile 其余部分共用的分层环境缝。镜像运营方能看到传输内容，因此保持显式开启并在文档中注明。(2) `pnpmAvailable` 不再只探测 PATH：找不到 `pnpm` 时继续试静态绝对路径（`/opt/homebrew/bin/pnpm`、`/usr/local/bin/pnpm`、`~/Library/pnpm/pnpm`、`~/.local/share/pnpm/pnpm`、`~/.volta/bin/pnpm`、`~/.local/bin/pnpm`、`~/bin/pnpm`），最后逐个试 nvm 与 fnm 版本目录下的 pnpm——macOS GUI 应用不继承 shell PATH，打包桌面应用因此看不到终端可用的 pnpm、悄悄走了自研路径；解析到二进制后，`runPnpm` 委托的正是终端 `dsh plugin add` 已证明在本机可用的那个 pnpm。往安装框粘贴整条 shell 命令同样会被拒绝并给出专门提示。

**身份校验不变，另加唯一包提升。** 根目录没有 `package.json` 的仓库（如 `dsh-api-balance` 这类 shell 安装器发行版）、workspace 根、非法包名的类型化错误原样保留——tarball 路径只是更快得出该结论。一项现场扩展：只包一个包的 monorepo 壳（根目录没有 `package.json`、其下任意深度只有一个 manifest）按那个包安装——`promoteSolePackage` 遍历解压出的树（跳过 `node_modules`/`.git`），把唯一 manifest 所在目录移到根目录，多个 manifest 时大声失败并列出路径。另一项现场扩展：声明的入口文件（字符串 `exports`、字符串 `exports["."]`、`main`，缺省 `index.js`）必须存在于安装目录——`assertPackageEntry` 在三条安装面（自研 npm、自研 git、pnpm 委托）上都执行，没有提交构建产物的仓库在安装时就失败并给出「构建并提交」的建议，而不是重启时把 Loader 弄崩（生态惯例是提交 `lib/`）。安装仍记录 HEAD commit，因此 `check-updates` 与 `update` 语义不变（`#ref` 固定到 tag 的安装永不报更新，这是正确行为）。

## 备选方案

**GitHub API 的 tarball 端点（`api.github.com/repos/o/r/tarball`）。** 每次下载多一次重定向、多消耗一次受限 API 额度；直连 codeload 两者皆免，且已验证接受 `HEAD`。

**在交给 pnpm 前改写 spec。** 有 pnpm 的机器上把 `github:owner/repo` 改写为 codeload URL 再 `pnpm add`，也能加速委托路径，但会改变 pnpm 写入 profile manifest 与其锁文件的内容。推迟：已报告的失败全部来自自研路径。

**monorepo 子目录支持。** tarball 可以搜深度 1 下唯一的 `package.json` 并从那里安装。拒绝：workspace 根校验有意拒绝多包仓库，猜测包根会在猜测的名字下挂载错误的包；改装已发布的 npm 包仍是文档化答案。

**用 jsDelivr 当镜像。** jsDelivr 有中国节点，但它分发文件而非仓库 tarball，其文件列表 API 也无法重建源码树——所以镜像缝是代理前缀（`https://gh-proxy.com/` 风格），转发真实的 codeload/API URL。ghproxy 家族服务是第三方且不稳定；该缝接受任意 http(s) 前缀，用户可指向自己网络能到达的镜像。

## 结果

- 目录里的 GitHub 插件安装不再因克隆卡顿超时，没有 git 的机器也能装，且只下载源码树（无历史、无 pack 协商）。
- 新增一类网络依赖面：api.github.com（限流、可带 token）与 codeload.github.com（不限流、无需认证）；两者都在有 git 时降级到克隆路径，也都能在受限网络上走配置的镜像前缀。
- 打包桌面应用能按绝对路径找到 Homebrew/npm 全局安装的 pnpm，GitHub 安装因此委托给终端已证明可用的 pnpm 路径——自研 tarball 路径从此是真正的回退，而不是 GUI 的唯一路线。
- git-source 测试套件现在覆盖 tarball 解压夹具、API/回退矩阵、镜像 URL 路由与镜像校验；网关端到端 git 测试 stub codeload 与 commits API 并断言不再发生克隆。
- 只放行 git 克隆、屏蔽 codeload 的防火墙环境经克隆回退照常工作。

## 相关

- [pnpm 委托、SRI 完整性与插件发现层](2026-08-15-pnpm-delegation-and-plugin-discovery.zh.md) 拥有本变更未触碰的委托路径；[bundle 风格插件安装与 git 身份诊断](2026-08-15-bundle-style-plugin-installs.zh.md) 拥有 tarball 路径仍执行的身份校验。
