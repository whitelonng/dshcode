# @deepseek-ai/dsh-experimental-agent-team

[English](README.md) | 中文

隐式 Root Agent Teams 领域。`ctx.agentTeams` 在 Lead Session 日志中维护扁平的 Lead／teammate roster、持久 peer mailbox 与共享任务 DAG。[Agent Teams Agent Note](../../../.agents/notes/implemented/feature/2026-08-05-agent-teams.zh.md)负责协作和隔离决策；[Team 子系统目录](../../../docs/subsystems/agent-team.zh.md)记录持久数据的字面形态与服务 API。

## 配置

```yaml
- id: agent-team
  name: '@deepseek-ai/dsh-experimental-agent-team'
  config:
    maxMembers: 8
    maxTasks: 256
    maxPendingMessagesPerMember: 64
    maxMessageBytes: 65536
    disposalTimeoutMs: 5000
```

每个限制都必须是正的安全整数。`maxMembers` 统计所有曾 provision 的名字，包括失败成员，因为名字永不复用。`maxTasks` 统计未删除任务。mailbox 限额按目标成员计算；字节限制覆盖完整的投递帧，包括稳定 id 与发送者名称。`disposalTimeoutMs` 限制已获准创建、mailbox dispatch 与 Team 自有 Activation 的 settlement 时长，使插件 reload 与进程 shutdown 在异常时明确失败，而不是无限等待。

该服务要求 Agent、Session、Session persistence 与 continuable-subagent 服务。没有持久 Session 存储的组合不会激活它。

## Team 身份与 roster

每个普通运行时 Root 都是一个隐式 Team 的 Lead，其 `TeamId` 等于 `SessionId`；因此，在写入第一条成员、消息或任务记录前，创建 Team 不需要额外状态。teammate 是记录在 Root Session 中的具名 continuable 直接 child。名字采用小写 kebab-case，最长 64 个字符，在 Team 生命周期内不可变。Session id 始终是持久化与授权身份。

`spawnTeammate()` 先追加并 flush provisioning member，再要求配置的 spawn 或 fork provider 使用预留 child id 创建成员。provider 失败会追加持久 failed member。初始 inbox 消息获准后，先 flush child Session，再提交 active 边。Root 恢复时，只有独立持久 child 的直接 parent 与 continuable descriptor 匹配，并且其初始用户消息仍在持久 inbox 中或已经记录进历史，provisioning 才转为 active；否则转为 failed。如果 recovery 在同进程 provisioning 竞争中先完成，creator 会接受匹配终态，或报告 `TEAM_PROVISIONING_CONFLICT` 并 drain 已被 recovery 标为 failed 的 child。dispose 会关闭准入，中止并等待已获准的创建与 mailbox dispatch 事务，再让 continuation owner 释放 roster 中确切的 live direct child 及其后代；Lead 的非 Team continuable child 不受影响。cleanup 失败会让 dispose 明确失败。该对账覆盖 Root provisioning 与终态成员边之间的崩溃和 reload 窗口，同时不复用名字或遗留孤儿 Activation。

fresh child 不带 parent 历史 seed。fork child 只捕获一次 Lead 的已完成 turn 前缀，不包含正在执行 delegation 的 turn。继承的 Team 记录带有旧 Root 的 `TeamId`，普通 fork 成为独立运行时 Root 后会忽略这些记录。roster 之外、由 provider 管理的 subagent 不会被误认为嵌套 Team Lead。

roster 同时报告持久 provisioning／failed phase 与实时 `running`／`idle` 状态。active 但不驻留的 teammate 显示为 `inactive`；后续 wakeup 投递会经 continuation owner 冷恢复它。

## 持久 mailbox

`sendMessage()` 校验 peer 成员关系，追加 `team/message/queued` 并 flush，之后才尝试投递。结果始终标识该持久消息；`queued` 表示即时投递被推迟，并不表示需要重发。target 为 live 时，quiet 投递会立即注入、flush 并确认上下文，但绝不会激活 inactive target；inactive target 的 quiet 消息会保持 queued。wakeup 投递成为 target 的下一个 FIFO turn，并在需要时冷恢复它。

目标消息以 `Team message <id> from <name>:` 开头，并在 `TeamMessageSource` 中保留同一 id 与发送者。target Session 在 pending inbox 或已记录的用户消息历史中持久保存该身份后，Lead 日志才追加 `team/message/delivered`。即时准入按 target 和持久 queue 顺序串行化，恢复也按同一顺序重新投递 queued-minus-delivered 记录。重试前会同时折叠 live 与持久 target 的 inbox／历史状态，因此 inbox 已接受但模型尚未 claim 时发生崩溃也不会复制消息。Lead 日志 flush 成功后会唤醒当前 `waitForChange()` 调用方，调用方随后重新列出权威状态。

该保证是进程内重试加 target Session 去重，而不是跨进程 exactly-once。本版本没有跨进程共享 mailbox 事务，也没有 mailbox 时间线 UI。

## 共享任务板

任务是完整的版本化快照。每次变更都携带 `expectedRevision`；陈旧调用方会收到 `TEAM_TASK_STALE_REVISION`，不会覆盖更新值。任意成员都可以创建、读取或 claim ready 且无 owner 的任务。Owner 或 Lead 可以编辑、释放、完成、重开或删除任务；只有 Lead 可以分配给其他成员。数字 `task-<n>` id 的后缀必须是安全整数；最后一个安全 id 已被占用时，创建会报告 `TEAM_TASK_LIMIT`，而不会复用该 id。

依赖必须指向当前未删除任务，并组成完整 DAG，不允许 self edge 或重复 edge。只有所有 blocker 都 completed，pending 任务才 ready。仍被未删除任务依赖的任务不能删除。删除任务作为 tombstone 保留以供回放和维持 id 稳定，但不占用 `maxTasks`，也不出现在 `listTasks()` 中。

`writeScopes` 会规范化为 workspace-relative 路径前缀。view 会对与 in-progress 任务的重叠发出警告，但绝不会阻止 claim 或授予文件写权限。它们是协作提示，不是锁。

`waitForChange()` 可以等待注册后发生的下一条 roster、task、mailbox 或实时 status 边，时长范围为 10 秒到 1 小时；它只报告等待是否超时，也不会回放调用前已经发生的变化。运行时 dispose 会释放当前等待，并使后续等待不经超时立即返回。调用方需要在唤醒或超时后重新读取权威状态。取消会保留 Error reason；非 Error reason 则通过 `TEAM_WAIT_ABORTED` 以结构化检查结果报告，不再强制转成 object 字符串。`interrupt()` 仅限 Lead，并委托 continuable-subagent 的 interrupt 路径以 `keepInbox` 只取消 live teammate 的当前 turn；它既不释放任务 owner，也不删除持久 mail。

独立的 `./invariant` 配套模块会把每条候选 Team event 对照已提交 Session 前缀回放。回放会先验证每个当前版本 Team payload，再将其纳入折叠状态；随后会在 append 前拒绝非法 member 转换、名字复用、超出范围的数字 task id、不连续任务 revision、非法任务依赖、重复 queue／ack，以及 target 不匹配的 acknowledgement。顺序与时间由 Session event 的 `seq` 和 `time` 负责，不在 snapshot 中重复保存。

## 模型体验

### Peer 消息

#### 模型看到的内容

每条已投递 peer 消息都是用户角色消息。第一个短文本块包含稳定消息 id 与发送者，之后原样附加发送者的内容块。roster、task 和 mailbox 记录本身只存在于日志，不进入派生模型历史。

#### Token 影响

每次 peer 投递都会把发送者前缀与消息内容加入 target 历史。任务和 roster 变更不增加模型 token；其面向模型的呈现属于 `@deepseek-ai/dsh-experimental-tool-agent-team` 结果。

#### KV Cache 影响

Peer 消息追加在 target 可复用历史前缀之后。冷恢复会先复用持久对话，再追加尚未投递的消息。

## 已知限制与暂缓事项

- **单进程、共享 checkout**：所有成员共享 cwd，修改立即可见；本包不提供 worktree、远端成员、自动 merge 或文件锁。
- **write scope 仅作提示**：Bash、formatter、codegen 和直接外部写入可以绕过文件版本检查；Lead 必须协调 owner 并检查最终 diff。
- **扁平且不可变的 roster**：只有 Lead 可以创建直接 teammate；不支持嵌套 Team、重命名、删除或名字复用。
- **不会自动释放 owner**：idle、interrupt、进程退出与工作失败都不会释放任务 owner。
- **mailbox 不保证跨进程 exactly-once**：不支持多个 harness 进程并发操作同一 Team。
