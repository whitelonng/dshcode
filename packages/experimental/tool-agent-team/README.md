# @deepseek-ai/dsh-experimental-tool-agent-team

English | [中文](README.zh.md)

Scoped model-facing adapter for [`ctx.agentTeams`](../agent-team/README.md). It installs the Agent Teams policy and collaboration tools in each implicit Lead and durable teammate scope. Scoped Team definitions shadow same-named legacy global continuable-subagent controls, so a composition that mounts both must disable the legacy definitions.

## Config

```yaml
- id: tool-agent-team
  name: '@deepseek-ai/dsh-experimental-tool-agent-team'
  config:
    freshProvider: spawn
    forkProvider: fork
```

`freshProvider` and `forkProvider` select registered continuable-subagent providers. The fixed model policy creates teammates only when the user explicitly asks for Agent Teams or teammates.

## Tools and authority

The generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-agent-team) owns exact schemas. The adapter supplies teammate creation; quiet and waking peer delivery; roster listing, waiting, and Lead-only interruption; and task create/list/get/compare-and-set update operations.

Every tool requires the exact calling `Agent`. `spawn_teammate` and `interrupt_agent` enforce Lead authority inside `ctx.agentTeams`, not only in their descriptions. All members can communicate with any peer and use the task board. Task mutations retain the domain's owner/Lead and revision checks.

`send_message` succeeds once mail is durable and never wakes an inactive target. `followup_task` also makes the message the target's next turn and can cold-resume it. A `queued` result is accepted durable work and must not be retried. Task readiness does not start an owner. Before arming its 10,000-through-3,600,000-millisecond edge wait, `wait_agent` checks for another member that is running or provisioning; without one it returns `noProgress` immediately with instructions to re-list and use `followup_task`. Otherwise it waits for one post-call Team edge, defaulting to 30,000 milliseconds, and callers re-list after wakeup or timeout because earlier changes are not replayed.

The plugin listens to Agent publication and installs its registrations through that Agent's scope. Fresh creation and cold resume therefore receive the same tool/prompt set before the first model request. Agent disposal and plugin HMR remove every scoped registration; reloading the plugin installs one fresh set in each still-live member without changing its continuation Activation.

## Model Experience

### Team policy and tools

#### What the model sees

One stable policy section states the exact Team role/name/id, explicit-delegation requirement, shared-cwd behavior, filesystem stale-version recovery, Bash/formatter/codegen risk, task/write-scope coordination, quiet versus waking delivery, no-retry mailbox rule, and the Lead's duty to wait before answering. The ten Team schemas from `spawn_teammate` through `team_task_update` appear only in Team member scopes.

#### Token effect

Fixed policy and schema cost on every Team member request. Tool calls add compact JSON roster, task, wait, or receipt results. Peer content is retained by the Team domain in the target's history.

#### KV Cache effect

Prefix-stable while the Team plugin generation, configuration, member role/name, and schemas remain unchanged. The per-member identity line differs across Agents. Tool results and peer messages append after the reusable request prefix.

## Known Limitations and Deferred Work

- **Prompt policy is coordination, not confinement** — it cannot stop Bash or external processes from writing overlapping files.
- **No autonomous team creation** — ordinary tasks do not trigger delegation unless the user explicitly requests it.
- **No Web controls** — browser roster and task-board presentation is outside this runtime package.
