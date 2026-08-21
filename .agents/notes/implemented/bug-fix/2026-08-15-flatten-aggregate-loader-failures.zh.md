# Agent Note: 在启动诊断中展开聚合的加载器失败

Status: implemented

[English](2026-08-15-flatten-aggregate-loader-failures.md) | 中文

## Problem

加载器以事务方式应用一个条目组，当多行同时失败时，会把各行的失败折叠进一个 `AggregateError`，其自身消息（`loader entries failed to apply`）不点名任何一行。`boot()` 只渲染被捕获错误的消息加上最深 cause 的堆栈，因此多行启动失败打印出的诊断无法据以行动，桌面恢复对话框按名字匹配归属时在文本中找不到任何已安装插件名，只能退回到「无法确定是哪个插件导致启动失败」。`mountPreset` 早已用私有辅助函数为预设挂载展平了同一结构，导致同一个聚合形状存在两种渲染方式。

## Decision

`dsh-app-boot` 导出规范渲染器 `formatLoaderFailure`：每个不同的错误消息占一行，每个 `AggregateError` 展开为各自的 cause，父消息已内嵌的 cause（加载器的条目包装错误会内嵌其 cause）不再重复。`boot()` 用它构造 `plugin tree failed to load` 详情，使每个失败行都点名自己的 id 与模块。`dsh-agent-presets` 改用共享渲染器替代私有的 `mountDetail`，并把 `dsh-app-boot` 加为 workspace peer 依赖。

## Alternatives considered

**改用共享的 `errorChain` 渲染器。** 否决：`dsh-app-boot` 没有 `dsh-llm` peer，为一处诊断把整个 LLM 能力栈加为启动胶水的依赖是错误的依赖方向；且 `errorChain` 单行 `outer: inner [m1; m2]` 的形式会把多行失败埋进一行无法换行的文本里，而启动诊断与桌面恢复对话框需要的是一行一个失败行。

**保留两个渲染器。** 否决：加载器的聚合形状是一份契约，一个规范渲染器才能让两个界面的诊断保持同步；私有辅助函数也缺少启动诊断所需的 cause 链遍历与内嵌去重。

**把渲染器抽成新的零依赖 util 包。** 否决：一个只有两个消费者的十五行函数，不值得一个新包的 manifest、invariant、README 与聚合注册；`dsh-app-boot` 本来就是这份启动诊断的归属者。

**让桌面外壳自己解析 `AggregateError.errors`。** 否决：那只能修好对话框，CLI 与其余所有 `boot()` 界面仍会打印不点名的聚合错误。

## Consequences

多行启动失败现在按失败行各打印一行点名信息，而不是只有一句「loader entries failed to apply」，桌面恢复归属也能在消息里找到已安装插件名。预设挂载失败经由同一渲染器继续点名每一行。启动单测在多项失败用例中钉住两个行名；既有的单失败与最深堆栈断言不变。

## Related

[在每个诊断边界渲染错误 cause 链](../../implemented/bug-fix/2026-07-20-error-cause-chain-diagnostics.zh.md) 拥有通用 cause 链渲染器；本记录只给启动与预设挂载两个边界补充加载器聚合专用的「一行一个失败行」形式。
