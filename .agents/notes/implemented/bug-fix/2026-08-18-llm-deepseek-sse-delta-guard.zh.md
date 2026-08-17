# Agent Note: SSE 翻译器只在非空 delta 上盖章工具 id 与名称

Status: implemented

[English](2026-08-18-llm-deepseek-sse-delta-guard.md) | 中文

## 问题

DeepSeek SSE 翻译器曾用每个 delta 值盖章工具调用块：`if (call.id !== undefined) block.callId = call.id`，`function.name` 同理。两类网关行为可绕过该检查（deepseek-ai/deepseek-harness#725；hy3 与 longcat-2.0 网关两者皆有）。续传 delta 会把字段以空字符串重新下发，覆盖已建立的工具名，导致每个工具调用都报 `unknown tool ""`。另一些网关下发 `null`，`null !== undefined` 会放行，随后字符串拼接把它转成 `"Globnull"` 这类破坏性 id。有缺陷的构建还会把空 `callId` 写入会话日志，而 `packages/core/session` 的加载期形状断言会让这些文件永远无法打开。

## 决策

`packages/llm/llm-deepseek/src/translate.ts` 只从值是非空字符串的 delta 盖章 `block.callId` 与 `block.name`；行内注释点明两种失败模式，避免守卫被放宽回 `!== undefined`。`packages/core/session/src/index.ts` 的 `assertMessageEventShape` 不再拒绝 `tool/result` 事件上的空字符串 `callId`，让有缺陷构建写出的会话文件可以重新加载；该字段仍必须是字符串。对损坏记录的下游行为不变：工具执行器把未知或空名称呈现为 `unknown tool`，会话不变式仍然拒绝本步骤中没有任何匹配 `tool/call` 的 `tool/result`。

## 验证

`translate.spec.ts` 中三条回归测试钉住空字符串与 `null` 的续传重复盖章；`session.spec.ts` 中一条测试加载 callId 与 tool-result 块均为 `""` 的 `tool/result`。回退盖章守卫后，前两条 translate 测试失败。`translate.ts` 保持 100% 行、分支与函数覆盖率。

## 考虑过的替代方案

**保留严格的形状断言。** 被拒绝，因为它会让有缺陷构建写出的每个历史会话文件永远无法打开：持久层拒绝整个文件，而不是只呈现那次失败的调用。

**只修翻译器，让损坏日志保持不可读。** 被拒绝，因为损坏已经进入持久存储；加载期容忍无需迁移或格式版本升级即可恢复访问。

**在负载解析器处更早拒绝 `null`。** 被拒绝，因为 `null` 本就在声明的线上类型（wire type）之外；盖章守卫是两种失败模式的唯一汇聚点，且 `typeof` 检查强于 `!== undefined`。

## 后果

带空工具 id 的会话文件可以加载与回放。修复与投影以尽力而为的方式处理这些 id，多个空 id 在修复映射中折叠为一个键。翻译器不再覆盖已建立的 id 或名称，`null` 也不会泄漏进发出的事件；网关从未下发真实 id 的调用仍会记录空 id，并在执行时以 `unknown tool` 失败。放宽的断言仅适用于 `tool/result` 的 callId；user/assistant 消息的空消息 id 仍然响亮失败。
