# Agent Note: 窄视口下 Plan chip 点击区域回归测试

Status: implemented

[English](2026-08-06-plan-narrow-viewport-regression.md) | 中文

## 问题

外部报告 dsh-external/issues#107（内部聚类为 deepseek-harness#1406）测得视口宽度在 760px 到 850px 之间时 Plan 控件与模型选择器发生重叠，模型选择器覆盖 Plan 控件的点击区域，导致在 800×720 下无法用鼠标退出 Plan 模式。其验收清单要求增加浏览器回归测试，断言 Plan 中心命中 Plan 按钮。

浏览器回归测试在当前 master 上复现了报告：800×720 下 Plan chip 与模型 trigger 重叠 36.9px，chip 中心命中 trigger 的 label。composer 控制行是 `display: flex; justify-content: space-between` 且 `.trailing { flex: none }`：当控件总宽超过卡片时，可收缩的 `.tools` 组把流内子项留在 `min-width: 0` 的盒内，于是 chip——溢出前最后一个流内子项——被绘制到 trailing 组上方。报告以来 Plan 控件形态已变（select → chip，`c20b988166`/`fe91919346`），控制行也获得过自适应能力（`c8c75ec891`，[web-composer-shared-width-axis](../feature/2026-08-04-web-composer-shared-width-axis.zh.md)），但该行没有换行，重叠在两次重构后依然存在。

## 决策

控制行换行而不是把左侧组收缩进右侧组的区域：`.row { flex-wrap: wrap }` 加上 `.trailing` 的 `margin-left: auto`——后者把 trailing 组（模型选择 + 发送）重新锚定到换行后的右缘，单行时 `space-between` 已把它钉在右侧。换行是验收中"空间不足时允许换行、折叠或重新排列控件"的选项，保持每个控件全宽（不做会隐藏模型名或 Plan 字样的 label 折叠），并且按构造在所有视口宽度下成立，而非依赖标定的容器查询阈值。

新增 `apps/web/tests/plan-control-row.e2e.ts`：通过真实 `/plan` 命令（无参数——命令 handler 不经模型回合即提交 plan/mode active，lifecycle-chrome 先例）进入 Plan 模式，因此测试在任何模式下都无需模型调用，仅在 replay/refresh 下无需 API key；providers-only fixture 挂载模型目录而无脚本可消费。该文件与所有同类 host 平面 e2e 一样采用成对登记：在 `apps/web/tsconfig.json` 的 exclude 列表（它导入 host 平面类型，client 图绝不编译它），同时在 `tsconfig.host.json` 的 host 聚合 include 中——恰好一个 TypeScript 程序拥有它，这也是 lint 类型服务获得程序的配对方式。

几何 golden 记录稳定事实——两个轴上的视口内位置与点击区域不相交——绝不记录绝对坐标，其像素值依赖安装字体且在 macOS 与 Linux 间不同。行为断言直接实现验收：点击区域不相交、点击 chip 中心（Playwright 的可操作性检查）经真实命令通道（`commands.execute` 执行 `/plan off`）退出 Plan 模式，且会话日志中最后一条 `plan/mode` 事件翻转为 inactive。

## 备选方案

**冷会话 seed（composer-tab-geometry 模式）。** 否决：退出路径经 `commands.execute` 执行 `/plan off`，需要 live agent，而冷 seed 会话没有；`connectFreshWorkspace` 保留一个，与产品的用户路径一致。

**golden 固定绝对 bounding box。** 否决：chip 与 trigger 宽度依赖安装字体，绝对坐标会在平台间漂移而不反映行为变化。

**复用 plan-review fixture 形态（exit_plan_mode review takeover）。** 否决：takeover 会替换 composer 控制行，而被测表面正是控制行。

**chip 与/或模型 trigger 的容器查询 label 折叠。** 否决（作为修复）：两个包（ui-plan、ui-model）需要各自标定阈值，且 chip 单独折叠为 icon-only 在报告视口下仍剩约 7px 重叠，除非 trigger 也折叠。换行是一个包中的一条规则，且在所有宽度下成立。

## 后果

任何改变控制行布局的后续改动——字体、间距、媒体查询或容器查询——一旦重新引入重叠或把 chip 沿任一轴移出视口，本测试即失败。测试在 replay/refresh 模式下无需 API key：Plan 模式经命令 handler 切换，不经模型回合；providers-only replay fixture（无录制脚本，跳过消费检查）挂载模型目录，使触发器渲染真实的长标签——正是使报告重叠可测量的宽度；测试在测量前断言该标签。golden 在 replay 与 record 模式下比较，在 refresh 模式下重写。
