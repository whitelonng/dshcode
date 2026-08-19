# `@deepseek-ai/dsh-web-app`

[English](README.md) | 中文

dsh 浏览器表层组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.md) 之上：设置 coding persona，插入 Web 宿主行（webserver、API 网关、workspace、投影缓存、存储）、浏览器插件名录与始终挂载的客户端插件重载链（[`dsh-client-hmr`](../../client/hmr/README.md)，在重建 watcher 改写客户端 bundle 之前保持空闲），并挂载本包的 `web-runtime` 粘合插件（配置为 `{printUrl, surfaceContext, trustedHosts}`）。该插件通过 `@deepseek-ai/dsh-web-frontend` 的 exports 解析已构建的前端 dist，只采样一次依赖 bind 的 LAN 信任信息并将其作为 `webRuntime` 提供给浏览器信任栅栏和客户端名录，挂载 [`frontend-static`](../../host/frontend-static/README.md) 回退席位所有者，在 `surfaceContext` 为 true 时注册 Harness 源码与 Web 表层提示词段落，以及 bash 可见的 `DSH_WEB_URL` 运行时变量，并在 `printUrl` 为 true 时等自身的 Loader 配置树结算后再打印 `dsh web:` URL 行，避免兄弟行失败时公告一个已失效的应用。本组合包还持有应用命令行：普通 `web-startup` 提供方（[`src/startup.ts`](src/startup.ts)）注入 `ctx.cmdlineArgs`（[`dsh-cmdline`](../../boot/cmdline/README.md)），解析 `--host`、`--port`、可重复的 `--trusted-host` 以及应用自己的 `--help`，再提供 `webStartup`。它会在发布该服务前拒绝 `--host 0.0.0.0`，因为 CLI 目前有意不支持绑定所有网络接口。由 flag 配置的行会注入该服务，并在惰性配置中直接读取它，因此参数解析完成前不会有任何东西绑定端口，`dsh --profile web --help` 也不会启动服务器。[`dsh-headless`](../headless/README.md) 是同一 base 之上的同级表层，不挂载本组合包。

随发行版提供的 `web` profile 只叠加内置的 base 与本组合包；[dsh-genui](https://github.com/omdsh-dev/dsh-genui)、[dsh-annotation](https://github.com/omdsh-dev/dsh-annotation) 与 [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) 聚合包作为可选的社区产品随发行版提供，默认关闭。本组合包的 manifest 把聚合包的九个入口包与 whale-song 皮肤包声明为同一锁定版本的直接依赖，使 profile 模块回退目录能在 profile 启用这些入口后从 profile 目录解析它们；它还挂载仅限回环访问的 [`plugin-control`](../../host/plugin-control/README.md) Host 行，其部署目录可以把 GenUI、Annotation 与九个 dsh-web-ui 行作为一个产品统一持久化启用状态。浏览器端的 Plugins 设置是单一合并后的插件列表页：上方为用户插件（安装框、已保存的启用开关、更新/卸载），下方为默认折叠的内置 Loader 条目（仅开关），由 [`plugin-installer`](../../host/plugin-installer/README.md) 与 [`plugin-inventory`](../../host/plugin-inventory/README.md) 网关提供服务；更改在 DSH 重启后生效。

上游皮肤中心会在自身所在位置旁边读取 `skins/` 目录，而任何打包部署都不提供该目录；本仓库通过 `patchedDependencies` 给 `@linxin666/dsh-client-ui-skin-center` 打补丁：让它在原始位置不存在时沿祖先目录查找、让受管区段总是插入当前皮肤的插入行（已发布的聚合包没有把任何皮肤行装进组合层），并在应用成功后对运行中的 Loader 树做 live reconcile——打包 Electron 无法提供 Cordis HMR 且桌面版不监听 patch 文件，这一步是应用即时生效的唯一通道。`scripts/link-community-skins.mjs`（postinstall）与桌面打包的 stage 步骤把已安装的皮肤包装进这棵树，因此皮肤中心的七张卡片（含 whale-song）在源码启动与打包部署下都能试用和应用。

## 模型体验

### Harness 源码与 Web 表层上下文

#### 模型看到的内容

当 `surfaceContext` 为 true 时，`harness:source` 段落标明磁盘上的 Harness 实现，但不会声称它就是工作目录；全局段落 `app:web-surface`（顺序 −98）则向模型说明 GUI：规范的本地 URL、「this page」指代什么、更新约定（重载接收端始终开启；无刷新重载还需要 `pnpm run dev:web` watcher），以及不要启动替代服务器的指令。`DSH_WEB_URL` 还会连同描述出现在受管 bash 环境中，每次调用时从运行中的服务器解析。当它为 false 时，这两个段落和该变量都不会注册。

#### Token 影响

每个会话一行源码说明和一段提示词，外加两行受管环境变量；每个进程内保持恒定。

#### KV Cache 影响

该提示词段落位于系统提示词靠前位置，且在进程整个生命周期内稳定（端口是启动期事实），因此不会使跨轮次缓存失效。

### 可选社区插件

#### 模型看到的内容

在社区开关启用后，dsh-genui 会添加 `dsh-ui` 输出指令以及 `render_ui` 和校验工具；dsh-annotation 只在用户发送批注时加入模型可见的批注文本；dsh-web-ui 除浏览器面板、任务看板、Git 图、实时统计、远程 Web UI、设置与皮肤外，还包含 SSH 工具和提示词贡献。上游包拥有其详细提示词、工具、持久化、远程访问控制与安全行为。具体而言，SSH 主机配置和凭据仍属于宿主数据，SSH 路由仅限回环访问，远程 Web 访问则需要使用该插件的配对流程。

#### Token 影响

GenUI 与 SSH 在启用时加入各自固定的指令和工具 schema；Annotation 只在请求携带用户批注时加入文本。仅用于浏览器的面板不会增加模型 token。

#### KV Cache 影响

GenUI 与 SSH 的提示词和工具贡献在单个进程内保持稳定。插件开关可以改变下一个进程的请求前缀和工具列表，因此重启后会开始使用新的提供方缓存前缀。

## 已知限制与延期工作

- **前端 dist 必须已构建**：对 dist 的 `require.resolve` 在激活时明确报错并给出构建提示；没有从源码直接服务的回退路径。
- **`lanAddresses` 是启动期快照**：启动后的网卡变化不会重新公告；打印的 LAN URL 始终与配置的信任栅栏一致。
- **社区插件开关需要重启**：不会假定外部插件能在实时 teardown 时安全释放全部路由、工具或浏览器注册，因此 Settings 只持久化期望的 profile 状态，不修改运行中的树。
