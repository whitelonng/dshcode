# Agent Note: 第三方模型的推理等级声明

Status: implemented

[English](2026-08-14-third-party-model-reasoning-efforts.md) | 中文

> 范围：让手工声明的第三方模型提供思考等级的模型设置表单表面。pi-ai 适配器早已支持每模型 `reasoningEfforts` 声明；本笔记补充写入它们的 UI。

## 问题

作曲器的模型选择器只为携带推理元数据（`model.reasoning.efforts`）的模型提供推理等级选项。手工声明的第三方模型——任何从设置添加的 OpenAI 兼容路由——不携带该元数据，除非 profile 作者手改 `settings.yaml`，因为模型表单只暴露 id/name/contextWindow/maxTokens。用户无法从 UI 让第三方 API 模型的思考等级可调。

## 决策

pi-ai 模型行的展开区（`ui-settings-models` 的 `ModelListEditor`——pi-ai 卡片与自定义 provider 卡片共享的编辑器）新增**推理等级**文本输入与**禁用推理**复选框：

- 文本把声明拼写为 `level: wire-spelling` 对，逗号分隔；`off` 允许单独出现（`off:` 或裸 `off`——pi-ai 的空 off 拼写，在 deepseek 方言发 `thinking: {type: "disabled"}`，其他省略）。等级来自 pi-ai 规范集合（`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`）。
- 解析位于新的 `reasoning-efforts.ts` 模块，编辑器与校验守卫共享。不可读文本在草稿中停靠字符串哨兵（`INVALID_EFFORTS`）——与容量使用的 `NaN` 哨兵同构——`validateDeepSeekModels` 在任何写入前拒绝，拼写错误不会到达 profile。
- 复选框写入 `false`（禁用推理）；取消勾选清除声明。留空把模型的推理能力交给已安装 catalog（或保持缺失）。
- 声明落入适配器已读取的同一 `providers.<route>.models[].reasoningEfforts`，经既有 `settings.mutate` 整值替换数组路径；无需宿主或适配器改动。

## 验证

新增单元测试覆盖解析/格式化/校验模块（空文本、`off` 拼写、未知等级、空非 off 拼写、哨兵拒绝）。组件套件以真实局部状态渲染 `ModelListEditor`，断言草稿收到解析后的声明、无效哨兵与禁用/清除开关往返。models-settings web 回放对重建后的 bundle 保持全绿（展开区收起时不渲染，golden 不变）。

## 备选方案

**卡片上的 provider 级推理控制。** 已拒绝——既有卡片注释说明了原因：推理是每模型能力，同一 provider 下的模型对等级意见不一，provider 级值会被部分模型拒绝。每模型展开区与选择器自身的每模型提供一致。

**结构化多级编辑器（每级一个输入）。** 已拒绝——文本拼写与容量字段一致，单条本地化消息校验且精确往返；七输入网格会为同一能力挤占展开区。

**经新线端点写入声明。** 已拒绝——settings-mutate 路径已原样携带任意 `models` 条目；表单只需产出值。

## 影响

- 第三方模型的思考等级完全可从设置调整：声明 `high: high, max: ultra`，保存，作曲器的模型选择器即为该模型提供这些等级，并派发声明的线上拼写。
- 不可读声明在任何写入前失败即报错；空字段不触碰既有模型与 catalog 条目。
- 表单每模型行加宽一个字段；展开区将其排除在收起视图之外。
