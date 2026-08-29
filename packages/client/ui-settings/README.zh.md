# @deepseek-ai/dsh-client-ui-settings

[English](README.md) | 中文

设置领域的底座，本身不含任何呈现内容。它提供 `ctx.settingsScope`——每个偏好设置行绑定自己那份持久化命名空间分区所用的宿主传输层；`ctx.settingsSchema`——设置插件使用的同步 schema 重建、校验与不可变路径编辑服务；并声明由注册方填充的设置 slot 类型：`settings.trigger`／`settings.header`／`settings.close`（界面框架内容）、`settings.action`（内容标题栏中的有序操作）、`settings.section`（每项功能一页）、`settings.plugins.tab`（“插件”分区内由各功能持有的页面）和 `settings.onboarding`（由各功能持有的有序页面）。它不依赖任何 `ui-*` 呈现包，因此任何持有偏好设置的功能都能够到它；设置**外壳**——`sidebar.settings` 占位方、它的导航与界面框架——位于 ui-settings-general，因为外壳一旦依赖 ui-sidebar，就会经 ui-layout 与 ui-theme 闭合出一条引用图环路。外壳自身的契约类型出于同一原因与外壳放在一起。

该插件注入 `connection` 与 `remote`，并持有浏览器中唯一的 `settings.describe` 读取方：一面持有完整应答的共享镜像，在每次转发的 `settings/document-updated` 事件与 `connection/reset` 时刷新（首次连接也包含在内——这次读取关闭了「提交落在急切读取与 SSE 订阅之间、其失效通知丢失」的窗口）。schema 操作为同步调用，由 `settingsSchema` 服务承载。`ctx.settingsScope.bind(spec)` 在**调用方**的 context 上返回一个由镜像**派生**的按命名空间 scope——scope 的 disposer 归调用方 fiber 所有，绑定不新增任何线路读取，某一行的激活绝不会阻塞在设置传输层上，且任一时刻每个派生面看到的都是同一份文档 revision。跨命名空间的表面（schema 内省、已服务命名空间目录、`hasDocument`）通过 `ctx.settingsScope.describe()` 读同一面镜像，这是一个读取／折叠面（`getSnapshot`／`subscribe`／`ensure`，另有把写应答折入的 `acceptView`）。scope 快照携带解析后的分区、组合 `base`、原始 `user`、revision、可写性以及 host／内存模式；字段只要出现在 `user` 中即视为覆盖，即使其值与 `base` 相等，`unset` 会清除该覆盖。写入仍归各 scope：单一字段路径，以命名空间 revision 作为 `expectedRevision` 围栏；提交成功的写入将应答折回镜像、不再重读，被拒绝或失败的最新写入触发一次镜像恢复读取，被取代的写入则把恢复留给后继者。若 spec 未提供 `decode`，则分区不是普通对象、未通过其重建后的 schema 校验、或携带本客户端无法重建的 schema 信封时，一律不发布任何值，于是行渲染自己的缺失状态，而不是一份半解码的值。冷启动读取次数由 `apps/web/tests/startup-rpc-budget.e2e.ts` 钉住；客户端代码中新增直连 `settings.describe` 调用即是对它的回归。
## 模型体验

无。设置领域底座为浏览器提供偏好设置存储与 slot 声明；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **远程浏览器没有持久化设置**：设置 RPC 仅限 loopback，因此在非 loopback 浏览器中绑定的 scope 以 `unavailable` 起步且从不跨线路，它支撑的每一行在那里都是无效的。
- **每次写入仅一个字段**：`set` 只发送单个 `set` op，因此需要同时改动两个字段的行没有事务可用，会发布两个 revision。
