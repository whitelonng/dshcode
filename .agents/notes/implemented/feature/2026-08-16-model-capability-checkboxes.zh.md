# Agent Note: 模型能力复选框与思考程度勾选

Status: implemented

[English](2026-08-16-model-capability-checkboxes.md) | 中文

> Scope：模型设置页的模型行编辑器、它写入的 pi-ai 与 DeepSeek 模型条目，以及 composer 模型选择器渲染的模型元数据。[推理等级声明笔记](../architecture/2026-08-14-third-party-model-reasoning-efforts.zh.md) 拥有最初的文本字段编辑器；本笔记在其之上新增复选框组，以及文本字段无法表达的能力声明。

## Problem

模型设置页只能以原始 `等级: 拼写` 文本编辑第三方模型的思考档位，对能力声明则完全没有界面：模型是否接受图片输入、能否生图、能否理解图片内容。只有图片输入有表达——pi-ai 条目可声明 `input`，harness 暴露 `inputModalities`——而生图与识图既无配置字段、也无 `LlmModelInfo` 通道、更无 UI，composer 的模型选择器因而无法区分这类模型。

## Decision

pi-ai 模型行的展开区新增**思考程度（Reasoning levels）**复选框组，覆盖 pi-ai 完整档位集合（`off` 至 `max`），外加既有**禁用推理（Disable reasoning）**复选框。勾选一个档位即以既有线上拼写加入存储的 `reasoningEfforts` map，或在新勾选时用协议默认拼写——即档位名本身，`off` 保持为空（「支持、不发送」）；取消即移除该档位，取消最后一个档位得 `false`——适配器对非推理模型的拼写。组旁显示协议族提示（OpenAI-completions 建议 `minimal` 至 `high`，anthropic-messages 建议 `low` 至 `xhigh`），仅供参考。原文本字段移入**高级（Advanced）**折叠，parse/format 逻辑原样保留，自定义线上拼写的部署不会丢失。DeepSeek 编辑器获得同一组复选框，但仅限 `off`/`high`/`max`——其协议线可分派的档位——写入 `llm-deepseek` 端到端接受的新按模型 `reasoningEfforts` 字段：catalog schema、`resolveModels` 校验（线上拼写固定为该路由的字面量；只提供 `off` 的 map 拒绝、改用 `false`）以及确切模型推理元数据（所提供档位取自 map 的键，默认档位取路由档位若在提供之列，否则取所提供的最强思考档位）。`thinking: disabled` 仍是部署锁，把任何按模型声明钳制为仅 `off`。

行内**能力复选框**（仅 pi-ai 行）写入新的可选条目字段，全部缺省缺席，既有配置不受影响：

- **图片输入（Image input）**切换条目既有 `input` 数组中的 `image`（`text` 保持为下限）；
- **生图（Image generation）**切换新的可选 `output` 数组中的 `image`，取消勾选时整个字段从条目删除；
- **识图（Image understanding）**切换新的可选 `capabilities.imageUnderstanding` 标记，并——因为能理解图片内容的模型必然要收到图片——同时让 `input` 保留 `image`。

生图与输入完全独立：会画图的模型不必接受图片，任何组合都不被强制。两个输入侧复选框是独立控件；存储的 `input` 由两者共同推导，因此单独取消识图后图片输入仍在，直到图片输入框也取消为止。DeepSeek 编辑器不渲染能力复选框：其协议线只支持文本、图片走适配器硬编码的 note 策略，复选框只会声明适配器忽略的东西。

harness 通道同步加宽：`LlmModelInfo` 新增 `outputModalities` 与可合并扩展的 `capabilities` 列表（`LlmModelCapabilityMap`，目前为 `image-understanding`），两者都对照编译期漂移门控词表校验，并在 `LlmRuntime.listModels`/`resolveModelInfo` 中像 `imagePolicy` 一样分离后透传。pi-ai 适配器把新条目字段解析进已解析 profile 的旁表——pi-ai 的 vendored `Model` 类型承载不了它们，因此与 `configuredMaxTokens` 并排——再经 `LlmModelInfo` 透传。会话模型协议（`ModelCatalogModel`）携带 `inputModalities`/`outputModalities`/`capabilities`，`ui-model-selection` 为已声明的声明渲染小徽标；纯文本模型不加任何徽标。

## Alternatives considered

- **提供方级推理控件。** 与原笔记拒绝它的理由相同：思考档位是按模型的能力，同一提供方下的模型彼此不一致，提供方级取值会被部分模型拒绝。
- **把能力标记做成 `LlmModelInfo` 上的平铺布尔。** 拒绝——可合并扩展的 map 让插件新增的能力在缝上保持类型化；平铺布尔需要每个能力一个字段，且没有强制的扩展约定。
- **扩展 pi-ai 的 `Model` 承载新字段。** 拒绝——pi-ai 是 vendored 的；已解析 profile 的旁表（`configuredMaxTokens` 先例）在不动依赖的前提下承载它们。
- **让识图强制勾上图片输入。** 拒绝——复选框保持独立控件；识图仅在存储层蕴含图片输入，这正是推导出的 `input` 数组表达的语义。
- **只做复选框、去掉原文本字段。** 拒绝——自定义线上拼写是真实部署需求；高级折叠在不让主界面拥挤的前提下保留它。

## Consequences

- 思考档位编辑变成每档一个复选框、默认拼写取协议默认，同时高级折叠继续支持任意线上拼写；存储格式不变。
- DeepSeek 模型可以声明按模型的推理子集；未声明的模型逐字节保持路由级行为。
- 能力声明是声明性、建议性的：harness 将其暴露给选择器与徽标，而本适配器的文本缝从不调用生图，因此 `output` 与 `capabilities` 之上没有任何超出声明本身的依赖。
- `LlmModelInfo` 与 `ModelCatalogModel` 表面加宽；扩展模态或能力词表的插件必须同步扩展 `LlmRuntime` 中的运行时 gate 与类型层 map。
- 仅含 `off` 的声明在客户端与适配器解析处都被拒绝、要求改用 `false`，与既有 pi-ai 规则一致。
