# Agent Note：alpha.4 同步把 fork 特性搁浅在被重写的平面上

Status: implemented

[English](2026-09-04-alpha4-sync-stranded-fork-features.md) | 中文

## 问题

dsh-v0.1.2-alpha.4 同步重建了 fork 自有特性所依赖的平面：apiproxy 变为 Typert 的 session/workspace controller 与 Gateway，会话 assembler 被重写，WebWorker 部署及其打包器演进，插件设置页拆分为两个 tab。fork 的消息删除/编辑、归档会话管理、插件管理三个特性只剩对合并后已被移除表面的调用，于是分支带着死 UI 交付——删除/编辑静默无效或在页面里抛错、归档会话对话框搁浅、插件工具目录为空——外加一个无法启动的打包预览，而静态检查 lane 全绿。

## 决策

在合并后的平面上按合并代码已经隐含的契约恢复每个特性：

- 消息删除/编辑是 session-controller 的 Remote 方法，携带合并前的表面范围展开（用户消息删除其整个 turn，助手消息删除自身及其 step 的工具结果，turn 结束锚定整个被中断的 turn；运行中的 turn 返回 `agent-busy`；子会话本地拒绝）。assembler 找回转录编辑时的重建分支，让活跃连接折叠删除与编辑替换，`deleteAt`/`editAt` 从会话面穿线到按键控的聊天节点渲染器。
- 归档三操作（列表、恢复、永久删除）是共享 workspaces 客户端服务背后的 `workspace/*` Gateway remote。永久删除对仍活跃的会话以 `workspace/session-active` 拒绝，`session/deleted` 作为 `api-session/deleted` 转发，让每个打开的客户端逐出被删行。
- WebWorker 平面以上游对齐承载恢复的插件组合：为 `node:stream/web`、`node:stream/promises`、`assert`、`node:string_decoder` 注册静态 node 模块并提供真实模块面，`node:events` 的默认导出按 Node 语义回答类本身，加载器降级后的 meta 面补上 `import.meta.dirname`，worker host 按镜像 manifest 的 profile 名提供 `profileUserPatchPath`，`apps/web` 依赖元数据与上游一致。
- web 测试脚手架与规格跟随已交付的产品：脚手架提供 launcher 的 `profileUserPatchPath`，插件规格驱动两个已交付的 tab，en 对话框对真实英文表面录制，locale 回退期望遵循 fork 文档化的中文优先回退。

## 曾考虑的替代方案

**在 Gateway 之外保留 fork 的 apiproxy。** 否决：单一 API 平面正是这次同步的目的；第二套传输会分裂会话真相，并重新引入 Gateway 两段式 `claimsEndpoint` 契约已消除的点号端点歧义。

**为活跃会话重建合并前的 dispose-on-delete 行为。** 否决：永久删除活跃会话会与其 agent 竞争。合并后的表面有明确的关闭 turn 模型，且拒绝文案早已预示这一点，因此永久删除要求会话已归档，客户端如实提示。

**放宽 worker 镜像以承载闭包请求的一切。** 否决：打包清扫的存在意义就是对未声明模块让打包失败。为被请求的标识符补真实 builtin 面并纠正依赖元数据，让该失败模式保持响亮，而不是交付一个把下一个未声明导入藏起来的更大镜像。

## 后果

三个特性在合并后的平面上端到端恢复可用，并在合并代码要求之处契约会更窄：活跃会话拒绝永久删除，完成的删除会从每个已连接客户端逐出该行而不是复活。规格驱动已交付的产品而非合并前的表面，因此下次同步的适配面是规格差异而非静默特性丢失。worker builtin 面是 fork 持有的平台代码——组合请求新的 node builtin 时必须向注册表添加真实面，打包清扫仍是让遗漏失败的守卫。
