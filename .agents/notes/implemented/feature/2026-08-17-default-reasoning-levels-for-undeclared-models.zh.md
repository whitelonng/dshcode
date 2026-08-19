# Agent Note: 未声明思考等级的第三方模型默认提供 off/low/max

Status: implemented

[English](2026-08-17-default-reasoning-levels-for-undeclared-models.md) | 中文

## 问题

手工声明的 pi-ai 模型——用户自建供应商路由的模型列表——若没有 `reasoningEfforts` 声明，会被报告为非思考模型（`reasoning: false`），于是作曲器的模型选择器完全不提供思考等级控件。使用普通 OpenAI 兼容网关的用户因此无法为自己的模型选择或调整思考强度，尽管大多数这类网关都支持常见思考等级。设置编辑器也复现了这个缺口：对什么都没声明的模型，等级勾选组一片空白。

## 决策

没有 `reasoningEfforts` 声明的手工声明模型在两个表面都默认提供 `off` / `low` / `max`：

- **适配器**（`packages/llm/llm-pi-ai/src/catalog.ts`，`resolveModelReasoning`）：字段缺失且模型 id 不匹配任何内置目录条目时，物化模型携带 `reasoning: true` 与一张恰好支持 `off`、`low`、`max` 的思考等级映射——`off` 与 `low` 保持缺失（pi-ai 的「支持且按默认派发」：不发送任何东西 / 发送等级名本身），`max` 以自身名称作为 wire 拼写（否则 pi-ai 会把它钉为不支持），其余等级全部钉 `null`。重声明目录 id 的模型继续完整继承目录条目能力，不受影响。
- **编辑器**（`packages/client/ui-settings-models`，`ModelListEditor` 通过 `DEFAULT_UNDECLARED_EFFORTS`）：存储为空时，勾选组预勾 `off` / `low` / `max`，使显示与生效默认一致。预勾只用于显示——存储值在用户勾动等级之前保持 `undefined`，勾动则以默认 offer 为基础构造声明。

`off` / `low` / `max` 是最小且诚实的默认：`off` 即省略拼写，`low` / `max` 是大多数 OpenAI 兼容网关接受的下上限，按 wire 回退（等级名本身）拼写。配置文件仍可显式声明任意其他集合——或对非思考模型声明 `false`。

## 曾考虑的替代方案

**默认提供全部五个基础等级。** pi-ai 的默认规则里，缺失的映射键对五个基础等级意味着「支持」，因此省略映射会宣传 `off` 到 `high`。否决：宣传了用户从未要求的等级，且需求明确只点三个。

**只改编辑器默认，不改适配器。** 只预勾勾选框而适配器不默认，选择器在用户保存表单前仍是空的。适配器默认才是让未改动的手工声明模型在作曲器中可选的关键。

**维持默认 `false`（非思考）。** 这正是本需求要补上的缺口：用户完全无法修改思考强度。

## 后果

手工声明模型现在开箱即在作曲器选择器中提供 `off` / `low` / `max`；此前什么都不提供。目录继承路径不变，`reasoningEfforts: false` 仍可剥离思考。编辑器的预勾只用于显示，因此仅打开并保存表单不会改写目录模型的继承能力。测试钉住两个表面：适配器的映射与支持等级，编辑器的预勾 offer 与在其上叠加勾动的行为。
