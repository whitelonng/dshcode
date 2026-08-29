# Agent Note: Web UI abbreviates POSIX home paths as `~`

Status: implemented

[English](2026-08-18-web-home-path-tilde.md) | 中文

## Problem

Workspace 悬停卡片和 Tool 调用摘要会显示完整的 POSIX 家目录路径。这些字符串很长，每行重复同一前缀，侧边栏和对话记录更难扫读。Windows 路径必须保持原样，因为 `~` 不是 Windows 文件系统约定。

## Decision

`host.describe` 把宿主账户的 `home` 作为必填字段上报。Client 与 Host 一同发布，因此该字段是必填而不是可选。ApiProxy 在 describe 时用 `homedir()` 填入。

`dsh-client-runtime` 中的 `abbreviateHomePath` 是仅用于展示的辅助函数。当路径是 POSIX 家目录或其后代时返回 `~` 或 `~/…`；`home` 缺失、为空或为 `/`，任一侧是 Windows 盘符或 UNC 路径，或只是前缀命中（`/Users/u` 不能收走 `/Users/u2`）时，路径保持不变。Tool 摘要先做工作区相对缩短，再调用该辅助函数，因此会话 cwd 内的路径仍然更短。`filePath`、Host 打开以及 Workspace 悬停复制仍使用作者给出的文件系统路径。

`ui-tool` 与 `ui-workspace` 在各自的 slot 注册上注入 `connection.hostDescription`。ChatView 不增加 Host 描述钩子。该字段在 `ConnectionHandle` 上是必填的；测试假对象提供一个来源，其快照在连接完成前可以为 undefined。

fixture 的 Host 家目录是 `/home/fixture`。第二个 fixture Workspace 位于 `/home/fixture/Documents/project`，组装回放可以悬停出 `~/Documents/project`，而不必移动现有的 `/tmp/fixture` 账户。TerminalBlock 自有的提示符标签折叠保持不变。

## Alternatives considered

**在没有真实 home 的情况下猜测 `/Users` 或 `/home`。** 否决，因为共享前缀不是账户家目录，`/Users/shared` 或 `/home/src` 会被错误缩写。

**同样把 Windows `%USERPROFILE%` 缩写成 `~`。** 否决，因为验收规则要求 Windows 路径保持原样，而且 Explorer 与 `cmd` 并不这样拼写这些路径。

**把辅助函数放进 `dsh-home-paths`。** 否决，因为该包在 Node 上展开配置里的波浪号；本辅助函数是浏览器展示改写，不能把 Node `os` 拉进 client 包。

**从 ChatView owner props 向下传递 `home`。** 否决，因为它会扩大 conversation 注入面和每一份 ChatView 测试夹具，而只有 Tool 与 Workspace 卡片消费这个展示事实。

## Consequences

POSIX 家目录下的 Workspace 悬停路径，以及缩短 cwd 后仍落在家目录里的 Tool 路径摘要，会显示为 `~`。复制与打开仍使用完整路径。Windows 盘符和 UNC 路径永远不会变成 `~`。若 Host 把 `/` 报成 home，不会把整个文件系统收成 `~`。首次 describe 之前或重连期间，来源快照为 undefined，路径保持未缩写。

## Testing

包测试覆盖 `abbreviateHomePath`、`toolRowModel`／`readCardModel` 的家目录缩写、Workspace 悬停展示与复制，以及 `host.describe` schema 与实时 `homedir()`。组装回放 `apps/web/tests/home-path-tilde.snapshot.ts` 悬停 fixture 中位于家目录下的 Workspace。面向产品 GUI 的 PR 仍需录制悬停卡片的真实浏览器 GIF。
