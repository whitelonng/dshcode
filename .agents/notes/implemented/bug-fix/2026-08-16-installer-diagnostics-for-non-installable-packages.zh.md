# Agent Note: 安装器诊断点名「无法安装」的包该如何修复

Status: implemented

[English](2026-08-16-installer-diagnostics-for-non-installable-packages.md) | 中文

## Problem

两种上游包形态会让 `pnpm add` 成功、装出来的东西却不可用，而此前两者都以误导性的安装器报错收场：

1. git 依赖的仓库根目录没有 `package.json`。pnpm 会安装一份占位 manifest（`_pnpmPlaceholder`），`readProfileIdentity` 随即报「pnpm-installed package X has no valid package.json name」——把锅甩给包名，而不是点明导致问题的 monorepo 结构。真实案例：`github:whitelonng/dsh-plugin-describe-image`，其插件位于 `packages/vision/tool-describe-image`。
2. 包 manifest 仍残留 `workspace:` 协议依赖（从 harness monorepo 拷出去的包）。pnpm 以 `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` 失败，安装器只透出原始 pnpm 输出尾巴，没有说明发布者需要改什么。

## Decision

`readProfileIdentity` 检测 pnpm 占位 manifest，抛出点名修复方式的诊断：用指向插件子目录的 `#&path:` 选择器重新安装。`installViaPnpm` 检测 pnpm 输出中的 `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`，追加修复指引：把 `workspace:` 区间换成已发布的明确版本，并把 harness peer 依赖标记为 optional，避免 pnpm 把过期的已发布副本自动装到被治愈的 profile 模块回退目录之上。两处检测都放在它们所诊断的代码旁边；不新增包或服务。

## Alternatives considered

**只修每一个坏掉的上游包。** 否决：包注册表无法被管控，任何用户都可以安装任何仓库，而安装器是每次安装都必经的唯一界面，它的诊断是唯一能保证把修复方式送到操作者面前的地方。

**在安装时预处理已装 manifest（就地改写 `workspace:` 区间）。** 否决：每个区间的版本选择是发布者的决定——harness 无从知道哪个已发布版本与该包的构建匹配；而且静默改写依赖会掩盖一个应当在上游修复的发布缺陷。

**在 `pnpm add` 之前探测仓库根目录。** 否决：探测需要自建 git/网络路径，还会重复 pnpm 对分支、commit 与选择器的解析；检测 pnpm 实际写入的占位符天然保真。

## Consequences

「根目录没有 `package.json`」与「`workspace:` 区间」两类安装现在都失败于逐条可操作的诊断。两种失败路径都会在 profile manifest 里留下新增的依赖条目（与之前一致）；操作者修正 spec 或上游 manifest 后重装即可。单测钉住占位符拒绝文案与 workspace 协议修复后缀；`dsh-plugin-describe-image` fork 的路径选择器与根 manifest 两种安装路径已在真实 profile 上端到端验证成功。

## Related

[pnpm 委托与插件发现](../../implemented/architecture/2026-08-15-pnpm-delegation-and-plugin-discovery.zh.md) 拥有本诊断所扩展的委托安装路径。
