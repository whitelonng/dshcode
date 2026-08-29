# Agent Note: pnpm 委托、SRI 完整性与插件发现层

Status: implemented

[English](2026-08-15-pnpm-delegation-and-plugin-discovery.md) | 中文

## 问题

桌面安装器自研的 registry 客户端一直在重复实现包管理器本来就有的东西：依赖树（只有 bundle 风格包装）、build 脚本（从不执行）、git monorepo 子目录（`#…&path:`——不支持）、tarball 完整性（HTTPS 之外零校验）。插件列表没有发现能力——用户必须自己知道包名或仓库。而且两个安装面分叉了：桌面端写扁平 fallback，CLI（`dsh plugin add`）写 profile workspace，同一个插件存在两份状态。

## 决策

**系统 pnpm 委托（模式 A，`src/pnpm.ts`）。** 网关每进程探测一次 `pnpm --version`（在候选目录补全后的 PATH 下，让 pnpm 的 `env node` shebang 在 GUI 进程里也能解析）并缓存结果。pnpm 可用时，`install`/`update`/`uninstall` 转发为 web profile workspace（`dirname(profilePatchPath)`，`initProfile` 早已把它建成 `nodeLinker: hoisted` 的 pnpm workspace）里的 `pnpm add`/`remove`——registry 解析、传递依赖、锁文件完整性、git monorepo 选择器与 build 脚本全部白拿。pnpm ≥10 拒绝 build 脚本（`ERR_PNPM_IGNORED_BUILDS`）会留下 `allowBuilds` 占位符；`approvePendingBuilds` 填掉它们并原样重试一次。重复安装已有依赖（pnpm 回答 "Already up to date"、不新增键）会按记录值匹配已有依赖名（pnpm 对 git spec 原样存储）或按解析出的 npm 名报告——安装面板因此能把 CLI 已装过的插件正常登记。装完按形态分流：`dsh.bundle` 包进 `dsh.profile.bundles`（无安装器行；`setBundleLayerEnabled`/`readBundleLayerEnabled` 为它的 patch id 写带 bundle 标记的覆盖行，开关照常工作），普通包写受管 insert 行。没有 pnpm 的机器保持自研路径逐字节不变。`writeState` 现在先确保 home 目录再上锁（委托路径不再创建模块 fallback）。

**SRI 完整性（`src/registry.ts`）。** tarball 字节在流入解压器的同时做 sha256/384/512 哈希，声明的 `dist.integrity` 必须至少匹配一个受支持的 token——不匹配与不支持算法集会大声失败；锁定的完整性记入 `plugins.json` 记录。

**发现层（`src/sources.ts`、`src/catalog.ts`）。** `$DSH_HOME/plugin-sources/` 分三层：`sources.yml`（索引源集合 + `official|community|untrusted` 信任分级；dsh-external hub catalog 为播种默认源）、`lock.yml`（TOFU：每次安装固定其解析引用）、`cache/<source>/entries.json`（枚举快照，TTL 6h、ETag 304 条件刷新、本地 `file://` 通道支持私有 hub）。网关端点 `search`/`sources`/`add-source`/`remove-source` 对浏览器桥暴露，四个面向模型的工具——`plugin_search`/`plugin_install`/`plugin_uninstall`/`plugin_status`——包装同一份网关状态，经 `scripts/gen-tool-catalog.ts` 的 boot manifest 条目编入 `docs/tool-catalog.md`。随该层一起上线的「浏览插件」UI 后来按产品决定移除（用户自己在 GitHub/npm 找插件、粘贴到安装框安装）；端点与工具作为搜索面保留。

## 备选方案

**内置 pnpm 二进制（模式 B）。** 把 pnpm standalone 可执行文件打进打包应用能彻底消除环境假设。推迟：模式 A 为没有 pnpm 的机器保留自研回退，而模式 B 的平台矩阵成本（每平台二进制）不值得在 A 于现场证明自己之前支付。

**发现层独立成包。** 存储与枚举可以像控制台插件一样放在网关之外。留在 `plugin-installer` 是因为模型工具与桌面壳共享它的状态，而桌面端到处都带着网关。

**只在 registry 声明 sha512 时校验。** 拒绝：sha256/384 声明真实存在，且没有受支持算法的声明必须大声失败而非静默跳过（不可校验的固定是虚假信心）。

## 结果

- 原来三类失败（聚合包依赖树、monorepo git 安装、build 脚本拒绝）在任何有 pnpm 的机器上消失——它们现在是 pnpm 的原生能力。没有 pnpm 的机器保持完全一致的回退行为，包括改进后的 git 诊断。
- 安装态多了一对权威（profile `package.json` bundles + insert 行），但 `plugins.json` 仍是带锁定完整性的 TOFU 记录；`enabled` 继续按行派生、从不落盘。
- 发现层是选择加入的网络面：播种的 hub catalog 首次搜索时拉取并按源缓存 6h；一个源不可达退化为跳过枚举，绝不会让搜索失败。
- 工具目录 golden 现在包含四个 `plugin_*` 工具（并把先前 `describe_image` 的采集漂移折进了更新后的期望清单）。

## 相关

- [Bundle 风格插件安装与 git 身份诊断](../../implemented/architecture/2026-08-15-bundle-style-plugin-installs.zh.md) 拥有本变更以层覆盖行扩展的 bundle 行格式；[用户插件安装与更新](../../implemented/architecture/2026-08-14-user-plugin-install-and-update.zh.md) 拥有本变更所委托的网关。
