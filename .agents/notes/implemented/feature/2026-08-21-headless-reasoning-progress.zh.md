# Agent Note: headless 将提供方推理流式写入 stderr

Status: implemented

[English](2026-08-21-headless-reasoning-progress.md) | 中文

## 问题

一次性 headless runner 会等待 Agent（智能体）完全停稳，再打印最终 assistant 文本。具备推理能力的提供方已经把推理作为持久化的 `assistant/chunk` 事件暴露，但耗时较长的推理响应会让终端在运行完成前始终保持静默。最终答案必须继续作为 stdout 中唯一的载荷，使命令替换和其他消费方保持稳定的结果通道。

此前的[直接使用核心服务入口决策](../architecture/2026-08-09-headless-direct-core-entry-point.zh.md)要求每次成功运行都保持 stderr 为空。该条款会阻止实时推理进度，因此由本 Agent Note 取代；其中关于传输、持久性与完成状态的其他决策保持不变。

## 决策

`headless-runner` 在启动工作完全停稳后、提交任务前，观察其创建的精确 Session。自身持有的区间以 `turn/start` 打开后，每个非空的 `assistant/chunk.reasoning-delta` 都会立即写入 stderr。一段连续推理以独占一行的 `dsh: reasoning:` 开始；各分片保持提供方顺序，不添加 token 边界装饰。推理块边界与用量元数据会保持该段打开；之后出现非推理块或输出分片、流结束、新轮次或 listener dispose（资源释放）时，如果提供方没有输出末尾换行，runner 会用一个换行终止该段。

该输出是既有持久化会话事件流的瞬时投影。runner 仍从 flush 后的日志而不是进度呈现状态推导最终文本与退出状态。LLM（大语言模型）适配器、agent loop（智能体循环）、Session 事件类型、持久化格式与 SDK 投影均不改变。

推理进度不按 TTY 启用，也没有单独 flag。重定向的 stderr 流与监督进程会收到和已连接终端相同的提供方报告内容。没有推理内容的成功运行仍不会写入 stderr；终止态模型错误与驱动器错误继续在任何已打开推理段终止后输出既有的 `dsh:` 诊断。

## 验证

包测试在推理分片后保持 Agent 活跃，并在 idle 前观察 stderr；测试同时固定由提供方终止和未终止的推理段换行归属，以及终止态错误。产品自有期望通过包含推理与工具调用的轮次驱动随附 headless profile，并固定 stderr 与持久化 Session。录制会话回放从标量及压缩分片记录重建预期 stderr，在压缩文本或工具调用输出处关闭推理段，并在录制模式下于 fixture 路径标记化之前使用原始运行日志。构建后二进制验收通过原生 DeepSeek SSE（Server-Sent Events）适配器发送 `reasoning_content`，要求推理出现在 stderr，同时 stdout 仍只包含最终答案。

## 考虑过的替代方案

**完全停稳后再输出推理。** 从持久化日志折叠推理能够保留内容，但在导致本功能产生的长时间运行区间内，终端仍会保持静默。

**包装 LLM 流。** 截取 `ctx.llm.stream()` 会把呈现职责放入请求路径，并重复处理 agent loop 已经追加到 Session 的权威分片。

**打印 spinner 或周期性心跳。** 定时器报告的是进程存活状态，而不是提供方进度；它还会新增间隔策略，并继续隐藏提供方已经给出的推理。首个推理分片前的时间仍保持静默；如果提供方会缓冲首个 token，可以另行处理。

**仅在 TTY 或显式 flag 下启用输出。** CI 与监督进程中的 headless 运行需要相同的进度信号，而隐式依赖 TTY 会让重定向运行与交互式运行产生差异。不需要推理日志的调用方可以重定向 stderr。

## 后果

具备推理能力的成功运行会把提供方报告的内容写入 stderr，因此日志收集器可能保留明显更多且可能敏感的模型输出。stdout 仍只包含一个最终 assistant 结果，没有推理内容的成功运行保持 stderr 为空，错误继续与推理内容分行，并且本决策不引入新配置或持久化格式。提供方发出首个非空推理分片前保持静默，这是明确的限制。
