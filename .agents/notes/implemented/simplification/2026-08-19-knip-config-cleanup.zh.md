# Agent Note: 删除 knip.json 中失效与重复的 workspace 条目

Status: implemented

[English](2026-08-19-knip-config-cleanup.md) | 中文

## 问题

`knip.json` 携带了大量不产生任何作用的 workspace 条目。其中一些指向已经不复存在的包，另一些与 `packages/*/*` 通配默认完全重复。这两类都让文件变大——790 行——并显现出配置已经超出了它所描述的包：读者无法分辨哪些条目在保护真实行为、哪些是惰性的。

## 决策

删除了 15 个 `workspaces` 条目：2 个指向工作树与 `HEAD` 中都不存在的包的失效键，以及 13 个 `entry`/`project` 与 `packages/*/*` 通配默认逐字节相同的条目。

- 失效键：`packages/util/home`（在 `4a09d9b34d`，harness home 解析器的合并改动中删除）和 `packages/client/web-ui`（无对应目录、无 git 历史，是孤儿键）。knip 6.16 不会标记失效的 workspace 键——这项稳定性检查在 knip 6.18 才引入——所以这些是本应在包消失时一并删除、却残留的惰性配置。
- 通配重复条目：`packages/host/webserver`、`packages/client/runtime`、`packages/core/tools`、`packages/context/tmux-context`、`packages/util/timeout`、`packages/util/output-retention`、`packages/goal/goal-round-driver`、`packages/goal/tool-goal`、`packages/util/home-paths`、`packages/fs/tool-fs-search`、`packages/client/ui-settings`、`packages/client/modules`、`packages/client/hmr`。每个都恰好声明了 `entry: ["tests/**/*.spec.ts"]` 和 `project: ["src/**/*.ts", "tests/**/*.ts"]`，与 `packages/*/*` 通配相等，且这些包仍然存在，因此通配现在以完全相同的方式覆盖它们。

本改动只做删除：`knip.json` 从 790 行降到 655 行，行为不变。`pnpm run knip` 在改动前后都干净通过（零问题、退出码 0），因为 knip 为每个已匹配的键选取一条 workspace 配置（`getConfigKeyForWorkspace` 按特定优先、不做数组合并），所以被删条目要么丢掉了无法解析的目标，要么回退到一个完全相同的通配配置。

## 备选方案

- 把 `zod` 及其它 workspace 级 `ignoreDependencies` 上提到根级。否决：根级 `ignoreDependencies` 是全仓库兜底，而这些豁免是刻意限定在 workspace 的（`cordis-host-runner` 的 README 记录了为什么 `src` 无法 import 被标记的依赖、而生成的 `lib` 里的 TypeRT 契约面需要它）。扩大作用域会掩盖未来任何包里真正放错位置的依赖。
- 升级 knip 到 6.18+ 以获得自动的失效 workspace 检查。延后：撰写时的最新版 6.32.2 会把大量 `@deepseek-ai/...` 测试依赖重新标记为未使用——也就是改变了分析语义，而不仅是新增提示。那是独立的依赖升级决定，带自己的 CI 影响面，不属于本次清理。
- 保留这些条目作为意图的文档。否决：与它挂在下面的通配完全相同的条目，除了通配本身外不记录任何东西；而指向不存在包的键确实会误导人。

## 结果

- `knip.json` 缩短了 135 行，并且只列出确实存在、且配置与通配默认有差异的包。
- 仍然显式的条目（54 个）都带有真实的特例理由——`e2e`/fixture/tsx 的 `entry`、超出默认的 `project`、或 workspace 级的 `ignoreDependencies`。
- knip 6.16 自身无法检测下一个失效键，因此删除包时仍须记得清理它的 `knip.json` 键；升级到 6.18+（在分析语义的改动被单独评估之后）会恢复这道守卫。
- 本改动落实了包清单提案中「绝不复述默认 stanza」的标准（[议题](../../proposed/process/2026-06-20-discover-package-inventory.zh.md)）；其剩余项——e2e 入口折叠与生成的清单——仍在提案中保持开放。
