# Agent Note：输入框 Tab 键把前导斜杠命令补全为文本

Status: implemented

[English](2026-08-22-composer-tab-completes-trigger-menu.md) | 中文

## 问题

在输入框里输入 `/` 或 `@` 触发菜单打开时，Tab 键会落到浏览器的默认焦点行走：光标从文本区跳到下一个可聚焦控件（工具栏命令按钮、模型席位、发送按钮），而按键永远不会补全用户正在过滤的命令。首次尝试让 Tab 像 Enter 一样选中高亮候选项，但这对手势来说是错的：ui-commands 的 pick 路径会立即执行无参数（bare）宿主命令（`packages/client/ui-commands/src/client/service.ts` 中的 `runDetached`），因此在打开的 `/` 菜单上按 Tab 可能直接运行命令，而不是把命令名补全进草稿。

## 决定

**Tab 只补全文本，绝不 pick。** `packages/client/ui-input-trigger/src/types.ts` 中的 `ArbitrateKey` 增加 `'tab'`。控制器的 `arbitrate` 把 `'tab'` 路由到专门的 `complete(state)` 分支：当前导 `/` 记号带有已就绪的高亮候选项时，它经 scoped `slash/input-insert-text` 事件把 `/<name> `（触发符 + 候选项名 + 尾随分隔符）拼接到记号 span 上——与 source 的 `{ text }` 结果共用的同一条纯文本插入路径——然后关闭菜单。草稿保持纯文本，因此回车裁决（`matchEnter`）像手工输入一样接管或执行该命令。其余所有菜单打开状态——尚无高亮、行内记号或 `@` 触发——只消费按键而不做任何事，菜单打开期间浏览器的焦点行走无法逃出输入框。菜单关闭、输入法组合中或已销毁时回答 `'pass'`。

**输入框把 Tab 路由到同一仲裁并阻止焦点行走。** `InputBar.onKeyDown` 在 Escape 分支之后拦截 `Tab`：调用 `keyboard.arbitrate('tab', composing)`，仅当结果不是 `'pass'` 时 preventDefault。工作区触发器路径和机器缺失路径在该分支之前就返回了，因此活动菜单之外的行为没有任何变化。

## 曾考虑的替代方案

**Tab 像 Enter 一样选中高亮项。** 在同一个变更里落地后否决：pick 路径就是 source 的执行路径，而 bare 宿主命令在 pick 时即执行——Tab 以运行命令的方式完成补全，恰恰是补全手势绝不该做的事。

**在冻结的 trigger 契约里新增逐 source 的补全钩子。** 否决：对命令来说候选项名就是补全文本，且纯文本插入路径已存在；为此手势扩展契约换不来任何东西。

**只在存在补全时消费 Tab。** 否决：候选项分组仍在加载时，Tab 会把焦点走出输入框，重演原始缺陷；无可补全时吞掉按键也好过交互中途丢失焦点。

**在 MenuView 里处理 Tab，而不是在输入框里。** 否决：焦点从不进入菜单（combobox 模式——行在 mousedown 时完成 pick、文本区保持焦点），因此菜单收不到键盘事件；文本区的 keydown 是唯一的拦截点。

## 后果

在打开的斜杠菜单上按 Tab，会把高亮命令名补全进草稿并让焦点留在文本区；命令只在用户提交整行后运行。`@` 引用菜单与行内记号只消费 Tab 而不补全——它们的 pick 结果携带结构（引用芯片、弹窗），裸文本拼接会破坏语义，因此 Enter/指针仍是它们的 pick 手势。Enter 不变。`ArbitrateOutcome` 联合类型不变；tab 永远只回答 `'consumed'` 或 `'pass'`。加号按钮打开的 popupSelect 命令弹窗保留自己的按键处理，不受影响。

## 测试

`packages/client/ui-input-trigger/tests/service.client.spec.ts` 固定控制器分支：tab 经 scoped insert-text 事件拼接 `/<name> ` 且不调用 onPick、对行内记号与 `@` 触发只消费不动作、输入法组合期间与菜单关闭时放行、分组加载期间消费。`packages/client/ui-conversation/tests/input-bar.client.spec.tsx` 固定 DOM 路由：被消费的仲裁会 preventDefault 掉 Tab 的 keydown（无焦点行走），`'pass'` 仲裁则保持原生行为。

## 相关

- [Web 输入状态机与斜杠管线](../architecture/2026-07-25-web-input-machine-and-slash-pipeline.zh.md)——本变更所扩展的触发管线仲裁。
