# Agent Note: 桌面端插件启动失败恢复

Status: implemented

[English](2026-08-15-desktop-plugin-boot-recovery.md) | 中文

## 问题

桌面端启动一个组合好的 profile；任何插件 import 失败、激活时拒绝或在加载时挂起，都会让整棵树中止，因此安装不兼容的插件后应用完全无法打开。唯一的恢复方式是手动编辑 `cordis.patch.yml`（或删除安装目录）。一个插件的问题绝不能阻塞整个产品；应用应当呈现失败、让用户选择禁用该插件后继续，并在之后让 Agent 在运行中的应用内部修复插件。

## 决策

桌面端拥有一个四层恢复管线：

**1. 有界失败记录（`$DSH_HOME/boot-failures.json`，由 `packages/host/plugin-installer/src/boot-failures.ts` 拥有）。** 按插件的环形记录，新的在前：至多 8 条、逐记录截断（message 2 KB、stack 16 KB）、每插件一条（新失败替换旧失败）、90 天留存（写入与读取时清扫）、以及会丢弃最旧记录的整文件字节上限。文件在构造上就有界——不存在后台清理任务。读取时畸形文件 fail loud，唯独启动清扫降级为空（诊断文件绝不能阻塞恢复）。安全模式标记（`$DSH_HOME/safe-mode`）与之并列。桌面主进程与树内网关通过包入口的再导出共享这些辅助函数，因此每个文件格式只有一份实现。

**2. 启动生命周期标记（`apps/desktop/src/boot-marker.ts`）。** `$DSH_HOME/boot-marker.json` = `{ state: 'started' | 'ok', at, pid?, bootAttempts }`。写入 `ok` 会重置连续失败计数；上一次是 `started` 而没有后续 `ok`，说明上次启动死在启动期。硬崩溃与主线程挂起——JS catch 无法恢复的两种情形——由该标记兜底，而不是错误记录。

**3. 看门狗与归因（`apps/desktop/src/recovery.ts`）。** profile 启动跑在 60 秒 `withBootTimeout` 之下；超时抛 `BootHangError`。归因是确定性的：抛出的加载失败归咎于其名字出现在失败文本中的已装插件（Loader 的激活审计会点名每个失败条目）；挂起归咎于最近一次成功启动之后安装或更新的插件。无法归因的失败（`cordis.patch.yml` 解析损坏、bundle 层损坏）没有归咎名单——恢复对话框退化为安全模式或退出。

**4. 恢复对话框与动作（`apps/desktop/src/main.ts`）。** 失败时主进程记录归咎名单，然后在任何窗口创建前弹出原生对话框：`继续（禁用插件并重启）` 通过安装器自己的 `setPluginRowEnabled`（与设置页开关相同的受管 `insert` 行 `disabled` 重写）禁用每个被归咎插件并重启；`安全模式启动` 写入标记并重启；`退出` 退出。连续三次启动失败后安全模式按钮成为默认项。安全模式以 `skipUserPatches` 流入 `runProfile`（profile 与 home 用户层跳过且不解析——损坏的 patch 文件是恢复场景而非启动阻塞——bundle 层与 overlays 照常生效）。`runProfile` 还新增了 `failLoud` 钩子，在既有的 fail-loud 退出前上报迟到的未处理插件初始化拒绝；桌面端把可归因的延迟拒绝记入环形记录。

**5. 插件列表修复面（`packages/client/ui-settings-plugin-installer`）。** 宿主网关提供 `failures {}` → `{ items, pluginRoot, safeMode }` 与 `set-safe-mode { enabled }`；卸载插件时清除其记录。标签页在匹配的插件行上渲染 `启动失败` 徽标、失败摘要与两个动作：`复制错误`（手动修复的剪贴板兜底）与 `让 Agent 修复`——后者打开一个工作区为插件安装根目录（`$DSH_HOME/profiles`，经 `workspaces.create` 幂等解析、新建时更名为 `DSH 插件`）的对话，连接空白会话，并把失败记录与安装路径作为首条消息注入——Agent 在工作区边界内修改插件，且首条消息自包含，无需读取工作区外文件。安全模式横幅说明用户层被跳过，并提供 `恢复正常模式并重启`。

## 备选方案

**同进程容错（把失败条目挂载为 disabled 并继续）。** 拒绝：需要改动 vendored Loader 的事务回滚语义，并容忍插件在 `apply` 中途抛错后留下的半注册服务；先禁用再重启的路径复用了既有的重启通道与既有的 patch 行写入器。

**由 Agent 做安装时冲突检查。** 拒绝：Loader 的真实启动才是权威冲突探测器；安装前让 AI 读插件代码是非权威信号。恢复流程已把权威错误送达用户，安装时预检仍是延期里程碑（M11）。

**不断增长的错误日志。** 拒绝：环形记录在每次写入时构造上有界，生命周期清理（重新启用成功、卸载）取代后台清扫任务。

## 后果

- 坏掉的用户插件现在降级为：对话框 → 禁用 → 重启 → 徽标 + 修复对话，或安全模式。内置（bundle 层）插件失败仍然 fail loud——那是产品 bug，不是用户插件问题。
- 挂起归因是“自上次成功启动以来安装”的启发式；同批安装多个插件可能过度禁用。安全模式是可靠兜底。
- 硬崩溃与主线程挂起不留下失败记录；启动标记覆盖这些恢复路径（连续失败时下次启动弹恢复提示）。

## 相关

- [用户插件安装与更新](../../implemented/architecture/2026-08-14-user-plugin-install-and-update.zh.md) 拥有安装管线与本恢复流程复用的受管 patch 行格式（用于禁用）；`failures`/`set-safe-mode` 端点扩展了该网关。
