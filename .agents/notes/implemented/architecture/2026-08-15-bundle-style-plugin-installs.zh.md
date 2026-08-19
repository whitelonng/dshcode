# Agent Note: Bundle 风格插件安装与 git 身份诊断

Status: implemented

[English](2026-08-15-bundle-style-plugin-installs.md) | 中文

## 问题

安装器的单 tarball 契约无法挂载聚合包：`@linxin666/dsh-web-ui-all`（"全家桶" bundle）安装后，其宿主入口是空操作、客户端半区只是 DOM 打标 shim——所有功能都挂在它的 `dsh.bundle.patch` 行和十二个 npm 依赖上，而安装器一个都没提供。桌面端自己的 web-ui 预设家族停留在应用内置的 0.1.2，因此安装或更新聚合包后看不到任何可见 UI，"先更新没用"。另外，git 来源安装克隆仓库后直接读 `<staging>/package.json`，没有任何防护：根目录没有清单的仓库（monorepo、空仓库）会以裸 `ENOENT: … open …/.staging-<ts>/package.json` 失败；而带有 workspace 根清单的仓库会被以错误身份装上去。

## 决策

`packages/host/plugin-installer` 现在为 bundle 风格包（npm 与 git 来源都算）安装完整的支撑面：

- **依赖树**（`src/dependencies.ts`，`installPackageDependencies`）：沿已安装清单的传递 npm `dependencies` 装入扁平 fallback，每个依赖像根包一样按 registry 解析并解压。仅当既有 fallback 副本版本与解析目标不同时才替换——这一条规则同时完成"把应用内置依赖（指向应用闭包的符号链接，见 [profile 插件 bundle](../../implemented/architecture/2026-08-05-profile-plugin-bundles.md) 与 Fix 5）升级到聚合版本"，而版本匹配的副本与应用闭包保持不动。遍历以 visited 集合终止，环与菱形只装一次；递归排除插件自身。进度复用现有 `status` 下载百分比（按 tarball），线协议不变。
- **Bundle patch 合并**（`src/bundle.ts`，`mergeBundleRows` / `removeBundleRows` / `setBundleRowsEnabled`，标记 `# dsh-plugin-bundle: <id>`；共享的 patch 文件辅助在 `src/patch-document.ts`）：已安装包的 `dsh.bundle.patch` 条目在文件锁内合并进 profile 用户 patch 层，保留每个非属主节点、注释与 `!!js` 表达式（bundle 节点用克隆而非从 JS 值重建，标签得以保留）。profile patch 已认领 id 的 insert 行——预设产品行（`dsh-plugin-control`）、插件自己的安装器行或先前合并的行——会被跳过，因为用户层按 push 组合，重复 id 会让条目挂载两次；既有行保持唯一权威。裸覆盖行原样追加（按 id 打补丁，后者胜出）。重装或更新先移除该插件先前合并的行，新版 patch 替换旧版。
- **生命周期集成**（`src/index.ts`）：`uninstall` 移除合并的 bundle 行（已装的依赖包作为未跟踪支持文件留在 fallback，后续安装复用或刷新）；`set-enabled` 把插件开关镜像到合并行上，家族开关控制整组；声明的 bundle patch 缺失时带路径大声失败。
- **Git URL 规范化**（`src/git-source.ts`，`normalizeGitUrl`）：`github:user/repo` 简写会展开为 `https://github.com/user/repo.git`、`git+` 前缀会被剥掉，然后才交给 `git clone`/`ls-remote`——粘贴的简写克隆不再依赖本机的 insteadOf/ssh 别名。
- **Git 身份诊断**（`src/git-source.ts`，`validateGitIdentity`；`readInstalledIdentity` 增加来源上下文）：克隆检出的清单在写任何内容之前先校验——根目录没有 `package.json` → 带 URL 的类型化错误；`private: true` 或声明了 `workspaces` → "多包 workspace 根，不是可安装的插件包；请改装已发布的 npm 包"；非法包名 → 类型化错误。两个辅助函数随既有共享辅助一起从包入口导出，供桌面壳恢复流程复用。

CLI 补齐了闭环：`dsh plugin --profile web add <pkg>` 在 profile 里转发给 pnpm，而 pnpm ≥10 会以非零退出拒绝依赖的 build 脚本（`ERR_PNPM_IGNORED_BUILDS`）并留下 `allowBuilds` 占位符——`apps/cli/src/plugin.ts`（`approvePendingBuilds`）会把这些占位符填成批准并原样重试一次，随后既有的对账把聚合包加入 `dsh.profile.bundles`，其 patch 在启动时作为 bundle 层生效（跨层重复的条目 id 会被就地替换、后者胜出，因此预设产品行在冲突的 bundle 行之上保持已保存状态）。

已用真实 registry 端到端验证：把 `@linxin666/dsh-web-ui-all` 装进临时 home，聚合包加全部十二个 `@linxin666/*` 子包以解析版本落入 fallback，十二行 bundle patch 全部合并。

## 备选方案

**已安装插件作为启动期 bundle 层。** profile 启动器已经为 `dsh.profile.bundles` 包组合 `dsh.bundle.patch` 层，聚合包似乎可以加一层。拒绝：有效条目列表在启动时按层 push 一次成型，而 profile 用户 patch 层已经带着聚合包九个 id 的预设行——重复条目会在激活期冲突（或静默遮蔽预设状态），`set-enabled`/`uninstall` 还需要另一套启动侧事实来源。合并进 patch 层保持单一权威：用户层，loader 已在组合它，插件列表已在改写它。

**给所有插件装依赖，而不只是 bundle 风格包。** 带版本替换的依赖树可能用满足插件 range 但与应用共享模块图不兼容的版本覆盖应用内置包（重复 React 是典型破坏）。把依赖树限定在声明 `dsh.bundle.patch` 的包上，爆炸半径保持选择加入；普通插件继续从应用内置依赖闭包解析自己的依赖。

**在 `plugins.json` 记录未跟踪依赖文件。** 拒绝：依赖包是支持文件而非用户插件——记录会让它们出现在插件列表，移除还需要跨共享依赖的所有权跟踪。它们留在 fallback 未跟踪；后续安装复用或刷新匹配副本，卸载从不删除别的插件可能用到的包。

## 结果

- 安装聚合包兑现了它的承诺：重启后家族以聚合版本挂载，无需升级预设目录即可换代内置 web-ui 家族，插件列表开关控制整组。
- 卸载后依赖包会在 fallback 累积——这是有界、已文档化的成本（是文件而非状态）；应用内置闭包从不被删除，只会被同名的真实目录遮蔽，启动时的 [fallback 修复](../../implemented/architecture/2026-08-05-profile-plugin-bundles.md) 会保留这些目录。
- monorepo URL 的 git 安装现在以可操作的错误信息失败，而不是 `ENOENT`；workspace 根误装（聚合包自己的仓库本来会被装成 `dsh-web-ui@0.1.1`）被拒绝。
- bundle patch 中与预设行冲突的 insert id 仍挂载预设行（带其已保存状态），而非 bundle 的副本——这些条目的用户可见开关仍是预设组。

## 相关

- [用户插件安装与更新](../../implemented/architecture/2026-08-14-user-plugin-install-and-update.md) 拥有安装管道、fallback 布局与本变更扩展的受管 patch 行格式；[profile 插件 bundle](../../implemented/architecture/2026-08-05-profile-plugin-bundles.md) 拥有本合并所镜像的 bundle 层语义。
