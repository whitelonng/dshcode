# @deepseek-ai/dsh-client-ui-workflow-run

[English](README.md) | 中文

这个浏览器插件把持久化的顶层工作流运行重建为独立 Chat 节点。它消费由 [`dsh-tool-workflow`](../../workflow/tool-workflow/README.zh.md) 拥有的四类 `tool-workflow/*` Session 事件，注册一个 `ConversationNodeDefinition`，并通过 keyed `conversation.chat.node` slot 渲染，不改变现有工作流工具卡。

## 持久状态与回放

`tool-workflow/run-start` 以 `runId` 创建唯一 Context；成员开始、成员结束和运行结束事件按日志顺序更新该 Context。只有 update 的历史尾页会保持 pending，直到更早页面补入唯一 start；此后 prepend、完整回放和实时 append 得到相同状态。若所属 Turn 或 Step 已关闭但终点事件缺失，界面把相应运行或成员显示为已中断，而不改写工具结果。

阶段组只来自真正开始过的成员。完全相同的阶段字符串归入同一组，字段缺省与空字符串保持不同身份；成员结算只改变状态，不删除或重排成员。

## 展示与导航

运行和每个阶段在所有状态下都是受控 disclosure。挂载时，运行中、失败、已取消和已中断层级默认展开，全部完成的层级默认折叠；此后用户可以点击整行，或按 Enter、Space 切换任一层级。普通运行更新保留当前选择，首次异常边沿只自动展开一次，正常完成只自动折叠一次；已完成阶段在同一 phase key 下开始新的运行成员时，该 Phase 与外层运行会再次自动展开。若一个完整的新干净周期在同一次渲染中送达，且运行仍处于活动状态，Phase 保持折叠，但外层运行会自动展开一次以展示更新后的摘要。完成状态会立即更新，但只要焦点仍位于展开内容内，自动折叠就会等待焦点离开。Phase 选择由 `WorkflowRunPanel` 持有，因此关闭并重新打开外层运行不会重置它们；renderer remount 会从持久事实重建每层的初始选择。运行使用 32 像素 `--dsw-alias-bg-module-platform` 背景行，常驻向右／向下 chevron，并以内联状态点加状态文字表达结局，不使用胶囊。阶段使用 32 像素 disclosure 行，在可伸缩主区显示标题与成员数，在固定尾部精确显示聚合状态且不重复状态点。成员使用 16 像素状态点槽、可省略名称区和固定 64 像素状态列。

只有所有实时事实同时成立时，成员才可打开子 Session：成员仍在运行、子 id 位于普通 Session 列表、列表行为 `origin: 'subagent'`、`parentId` 等于当前 Session，且列表行仍标记运行。带下划线的成员文字是唯一可见导航提示；键盘聚焦时，名称区显示 2 像素 business-primary 焦点环，右侧状态仍只显示“运行中”。组件只调用注入的普通 `sessions.open(id)`；远程、仅地址化、父级不符或终态的行都不可交互。

## 装配

本包把 Definition、locale 字典和 `workflow-run` renderer 都注册为 Cordis effect；移除客户端 entry 会撤销三者。shipped Web bundle 在 `ui-conversation` 与 `ui-tool` 之后装配该插件。

## 模型体验

无，因为本包只为人类展示持久 Session 事实，不增加 prompt、工具 schema、请求内容或模型可见结果。

#### KV Cache effect

无。

## 已知限制与暂缓事项

- 只有经 `dsh-tool-workflow` 发起的顶层调用会生成这些记录；嵌套 Code Mode 调用和直接 `WorkflowEngine` 消费方不会生成。
- 导航刻意只面向实时运行。终态成员继续保留供复盘，但本节点永不为其提供冷 Session 入口。
- 节点只显示运行、阶段、成员身份与状态；脚本、输出、错误、日志、用量、静态拓扑和控制操作都不属于本界面。
