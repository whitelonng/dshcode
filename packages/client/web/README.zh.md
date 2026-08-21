# @deepseek-ai/dsh-client-web

[English](README.md) | 中文

Web 启动内核：`new AppWebEntry(el, seams?).run()` 分两个阶段挂载客户端。模块阶段调用 Host 安装的 `window.__ModuleLoader__.create()`，传入 `window.__DSH_BOOT__`、外壳静态模块以及可选测试传输覆盖；facade 接纳 parser 预载的 registration 后返回构造好的模块系统与已解析 manifest。本包随后预取 `immediately` 层级。插件阶段挂载仓库内置的 Cordis Loader，通过 Loader 的 `internal` 接口注入该模块系统，统一创建全部图 entry，并等待每个 fiber 进入 ACTIVE。随后它把带标记的启动 DOM 交给动态 UI 渲染器的 `ctx.uiRenderer.mount(el)` 操作；渲染器先 hydrate 该 DOM，再切换到完整 UI。Graph、parser preload 与 facade 归 Host 所有；AppWebEntry 不感知 bootstrap package id，也不解析 wire 格式。

启动页只使用原生 DOM 与本地 CSS，因此客户端 bundle 或插件激活失败时仍能显示。其回退字体和颜色与加载期间到达的主题 token 一致。fiber 更新会保留同一个 spinner 节点，并在 entry 首次进入 active 时增长其 CSS 圆弧；hydrate 会继续保留该节点及其动画相位，直到应用提交。React 挂载、slot 渲染、应用组装和浏览器标题投影位于 [`ui-renderer`](../ui-renderer/README.zh.md)。Modules bundle 会缓存自身已物化导出，并在其普通图 entry 激活时提供闭包中的系统；Cordis service 等待使图 row 创建顺序不依赖该激活时点。

`PLATFORM_MODULES`（src/platform.ts）是外壳播种共享模块的唯一事实来源。它与 `PRELOADED_CLIENT_EXTERNALS` 一起定义全部动态 bundle 的隐式 external 基座；`dsh.client.external` 只添加基座之外的精确请求。

可选的覆盖参数 `seams` 会为外部 `<script>` 执行无法到达页面上下文的环境转发模块系统的 `loadBundle` 传输覆盖（`BootSeams`）；普通浏览器调用方省略此参数。预注入的页面传输是位于其前的默认值：当 `globalThis.__DSH_TRANSPORT__`（connection 包的 `ClientTransportHooks`）携带 `loadBundle` 时，模块阶段将其采纳为 bundle 传输并跳过 immediately 层级的 HTTP 预取——显式 `seams` 仍然优先。

## 模型体验

无。入口外壳负责启动浏览器插件树；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **应用会等待完整名册**：只要一个 entry 失败，不依赖框架的启动页就会保留并逐项报告；不支持部分 UI 可用。
