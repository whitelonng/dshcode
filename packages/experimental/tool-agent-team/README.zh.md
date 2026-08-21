# @deepseek-ai/dsh-experimental-tool-agent-team

[English](README.md) | 中文

[`ctx.agentTeams`](../agent-team/README.zh.md) 的 scoped 模型适配器。它会在每个隐式 Lead 与持久 teammate scope 中安装 Agent Teams 策略和协作工具。scoped Team 定义会覆盖同名的旧全局 continuable-subagent control，因此同时挂载两者的组合必须禁用旧定义。

## 配置

```yaml
- id: tool-agent-team
  name: '@deepseek-ai/dsh-experimental-tool-agent-team'
  config:
    freshProvider: spawn
    forkProvider: fork
```

`freshProvider` 与 `forkProvider` 选择已注册的 continuable-subagent provider。固定模型策略仅在用户明确要求 Agent Teams 或 teammate 时创建 teammate。

## 工具与权限

生成的[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-agent-team)负责精确 schema。该适配器提供 teammate 创建；quiet 与 waking peer 投递；roster 列表、等待和仅限 Lead 的 interrupt；以及任务 create／list／get／CAS update 操作。

每个工具都要求完全相同的调用 `Agent`。`spawn_teammate` 与 `interrupt_agent` 在 `ctx.agentTeams` 内部强制执行 Lead 权限，而不只依赖描述。所有成员都可以与任意 peer 通讯并使用任务板。任务变更保留领域层的 Owner／Lead 与 revision 校验。

`send_message` 在 mail 持久化后即成功，并且绝不会唤醒 inactive target。`followup_task` 还会让该消息成为 target 的下一个 turn，并可冷恢复 target。`queued` 结果表示持久工作已经接受，不能重试。任务 ready 不会启动 owner。`wait_agent` 在注册 10,000 到 3,600,000 毫秒的边等待前，会检查是否有另一个 running 或 provisioning member；如果没有，它会立即返回 `noProgress`，提示重新 list 并使用 `followup_task`。否则它会等待调用后发生的一条 Team 边，默认 30,000 毫秒；由于不会回放更早的变化，调用方需要在唤醒或超时后重新 list。

插件监听 Agent publication，并通过对应 Agent scope 安装注册。因此，fresh 创建与 cold resume 都会在第一次模型请求前获得相同工具／提示词集合。Agent dispose 和插件 HMR 会移除全部 scoped 注册；重新加载插件会为仍 live 的每个成员安装一套新注册，而不改变 continuation Activation。

## 模型体验

### Team 策略与工具

#### 模型看到的内容

一段稳定策略会说明确切 Team role／name／id、显式 delegation 要求、共享 cwd 行为、文件 stale-version 恢复、Bash／formatter／codegen 风险、task／write-scope 协调、quiet 与 waking 投递区别、mailbox 不重试规则，以及 Lead 必须在回答前等待。`spawn_teammate` 到 `team_task_update` 的 10 个 Team schema 只出现在 Team member scope。

#### Token 影响

每次 Team member 请求都有固定策略与 schema 成本。工具调用会增加紧凑 JSON roster、task、wait 或 receipt 结果。Peer 内容由 Team 领域保留在 target 历史中。

#### KV Cache 影响

Team 插件 generation、配置、member role／name 与 schema 不变时，前缀保持稳定。每个成员的身份行不同。工具结果与 peer 消息追加在可复用请求前缀之后。

## 已知限制与暂缓事项

- **提示词策略只负责协调，不负责 confinement**：它无法阻止 Bash 或外部进程写入重叠文件。
- **不会自主创建 Team**：除非用户明确要求 delegation，普通任务不会触发组队。
- **没有 Web 控制功能**：浏览器 roster 与任务板呈现不属于该 runtime 包。
