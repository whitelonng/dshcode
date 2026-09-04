# Agent Note: 等序系统提示词分段按激活顺序渲染

Status: implemented
Archived: 2026-08-25

[English](2026-08-24-system-prompt-section-order-ties.md) | 中文

## Problem

`SystemPromptRegistry` 使用稳定排序按 `order` 排列分段，因此相同 order 的分段会按插件激活顺序渲染。`tool:cordis` 与 `tool:workflow` 都声明了 `order: 115`，但两者在不同平台的全新组合中激活顺序不同。因此，ACP（Agent Client Protocol）与 SDK 的快照回放可能把相同分段组装成不同于已提交 `system-prompt.expected.md` 文件的顺序。

## Decision

在不改变既有相对顺序的前提下，为受影响的分段序列指定互不相同的 order：`tool:cordis` 保持 115，`tool:workflow` 使用 115.5，`tool:ralph` 保持 116，可继续运行的子代理指引保持 116.5，子代理报告指引保持 117。提示词文本与工具 schema 保持不变。

## Alternatives considered

**在快照 harness 中规范化分段顺序。** 已否决，因为运行时、请求标头和模型提示词仍然受激活时序影响，只有 fixture 比较会隐藏差异。

**在注册表中用分段名称打破并列。** 已否决，因为这会静默重排每一组现有并列。显式 order 让每个模型可见位置都由贡献该分段的插件就地决定。

## Consequences

Cordis 与 workflow 指引具有不依赖平台的顺序，同时 Ralph 仍排在可继续运行的子代理指引和子代理报告指引之前。需要稳定相对位置的提示词分段必须使用互不相同的 `order`；其他等序分段仍采用激活顺序，不属于本决策的范围。

## Testing

无密钥 ACP 与 SDK 快照回放会固定 Cordis 排在 workflow 之前，并保留 workflow、Ralph、可继续运行的子代理和子代理报告指引的顺序。完整快照套件验证刷新的 fixture。
