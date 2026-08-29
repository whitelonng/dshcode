# `@deepseek-ai/dsh-web-app`

[English](README.md) | 中文

dsh 浏览器表层组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.zh.md) 之上：设置 coding persona，插入 Web 宿主行（webserver、API 网关、workspace、投影缓存、存储）、浏览器插件名录与始终挂载的客户端插件重载链（[`dsh-client-hmr`](../../client/hmr/README.zh.md)，在重建 watcher 改写客户端 bundle 之前保持空闲），并挂载本包的 `web-runtime` 粘合插件（配置为 `{openBrowser, printUrl, surfaceContext, trustedHosts}`）。该插件通过 `@deepseek-ai/dsh-web-frontend` 的 exports 解析已构建的前端 dist，只采样一次依赖 bind 的 LAN 信任信息并将其作为 `webRuntime` 提供给浏览器信任栅栏和客户端名录，挂载 [`frontend-static`](../../host/frontend-static/README.zh.md) 回退席位所有者，并在 `surfaceContext` 为 true 时注册 Harness 源码与 Web 表层提示词段落，以及 bash 可见的 `DSH_WEB_URL` 运行时变量。自身 Loader 配置树结算后，它在 `printUrl` 为 true 时打印 `dsh web:` URL 行；`openBrowser` 为 true 且继承的 `SSH_CONNECTION` 与 `SSH_TTY` 均为空或不存在时，才会用默认浏览器打开规范宿主机 URL。SSH 启动仍保留 URL 行，但会跳过浏览器交接，因为本地转发地址由 SSH 客户端或编辑器持有。交接前，运行时会打印英文提示 `dsh web: opening the default browser; pass --no-open to disable`。短生命周期 Node helper 使用规范的脱敏子进程环境运行受维护的平台 opener。在 Windows 上，helper 会保持存活，直至短生命周期的 PowerShell launcher 退出，因为 `open` 会在 launcher 把 URL 交给 shell 之前、仅在 spawn 时返回；其他平台则在 opener 接受 spawn 后结束。helper 失败时会向 stderr 写入包含原因和手动访问 URL 的诊断，不会停止服务器，且任何路径都不会等待浏览器退出。本组合包还持有应用命令行：普通 `web-startup` 提供方（[`src/startup.ts`](src/startup.ts)）注入 `ctx.cmdlineArgs`（[`dsh-cmdline`](../../boot/cmdline/README.zh.md)），解析 `--host`、`--port`、可重复的 `--trusted-host`、`--no-open` 以及应用自己的 `--help`，再提供 `webStartup`；本机启动默认会打开浏览器，`--no-open` 则只对本次调用关闭该行为。它会在发布该服务前拒绝 `--host 0.0.0.0`，因为 CLI 目前有意不支持绑定所有网络接口。由 flag 配置的行会注入该服务，并在惰性配置中直接读取它，因此参数解析完成前不会有任何东西绑定端口，`dsh --profile web --help` 也不会启动服务器。[`dsh-headless`](../headless/README.zh.md) 是同一 base 之上的同级表层，不挂载本组合包。

## 模型重试默认值

Web 使用共享的有界 normal 默认值，在首次请求后最多再重试五次符合条件的失败。`deepseek-official` 与由 settings 新增的 pi-ai 路由在省略 `retryPolicy` 时使用该默认值；显式提供方策略仍然优先。Web 不再增加重试专用的组合覆盖，因此非 Web profile 的省略行为与之相同。

## 模型体验

### Harness 源码与 Web 表层上下文

#### 模型看到的内容

当 `surfaceContext` 为 true 时，`harness:source` 段落标明磁盘上的 Harness 实现，但不会声称它就是工作目录；全局段落 `app:web-surface`（顺序 −98）则向模型说明 GUI：规范的本地 URL、「this page」指代什么、更新约定（重载接收端始终开启；无刷新重载还需要 `pnpm run dev:web` watcher），以及不要启动替代服务器的指令。`DSH_WEB_URL` 还会连同描述出现在受管 bash 环境中，每次调用时从运行中的服务器解析。当它为 false 时，这两个段落和该变量都不会注册。

#### Token 影响

每个会话一行源码说明和一段提示词，外加两行受管环境变量；每个进程内保持恒定。

#### KV Cache 影响

该提示词段落位于系统提示词靠前位置，且在进程整个生命周期内稳定（端口是启动期事实），因此不会使跨轮次缓存失效。

## 已知限制与延期工作

- **前端 dist 必须已构建**：对 dist 的 `require.resolve` 在激活时明确报错并给出构建提示；没有从源码直接服务的回退路径。
- **`lanAddresses` 是启动期快照**：启动后的网卡变化不会重新公告；打印的 LAN URL 始终与配置的信任栅栏一致。
- **只观测交接启动**：平台 opener 接受 spawn 后即结束观察，但 Windows 会等待其短生命周期 PowerShell launcher 退出；之后的浏览器退出不会上报，已打印 URL 仍是手动访问的回退路径。
- **SSH 转发持有浏览器 URL**：打印出的规范 URL 指向远端宿主机 loopback 端点；自动交接会被跳过，SSH 客户端或编辑器必须暴露并打开其本地转发地址。
- **浏览器命令覆盖只能来自启动环境**：被发现的 `.env` 不得设置 `BROWSER`；只有继承值可以抵达会读取该变量的 opener 路径，避免 checkout 为自动交接选择可执行文件。
