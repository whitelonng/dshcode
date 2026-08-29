# Agent Note: client 插件装载——惰性 factory、Cordis 生命周期与热重载

Status: implemented

[English](2026-07-23-client-plugin-loading-model.md) | 中文

> 范围：浏览器侧插件装载机件——代码如何到达、Cordis 如何治理代码，以及热重载如何搭乘这套模型。本 Note 拥有装载链；[client 外壳分层 Note](2026-08-15-client-shells-and-dynamic-packages.zh.md)拥有包分类、构建 face、共享模块请求与 npm 依赖声明，[Web 客户端架构笔记](2026-07-19-gui-web-client-architecture.zh.md)则拥有 slot 与数据对象层。

## Problem

host 侧，cordis 插件装载站在 Node 的模块机制之上——require cache 与内部 ESM loader 拥有模块身份与字节。vendored `@cordisjs/plugin-loader` 在这层基座之上实现插件治理与热重载，二者在唯一一道边界相接：`Loader.internal`。

浏览器客户端跑同一套 cordis 插件机制，因此底下需要同样的基座——而浏览器没有 Node 模块系统。

常规前端工程在构建期消化全部依赖：单一 bundle，external 由打包器解决，运行时无物可管。在此之上再做运行时模块管理，正是这里的特殊需求。client 因此拆成两层：上层是经同一份 vendored Loader 的 cordis 插件装载，下层是模块粒度的依赖管理——`dsh-client-modules`。

下层供给四项能力：external（平台清单）、远程到达（同源外部 classic script 加惰性工厂登记）、版本化（内容哈希 rev）、热更新（invalidate/prefetch）。

插件 bundle 独立构建在 Vite 模块图之外。若把响应文本塞进内联 script，浏览器只能看到一次动态源码执行：网络资源、生成 bundle、TypeScript/TSX 源码之间没有标准 sourcemap 链，性能 profile 与 stack 只能落到生成后的 `client.js`；模块系统还要持有整份源码文本，并把同一项到达职责拆成 fetch 与 execute 两道传输边界。

在此之上，client 与 host 插件以一致的方式注册与装载：包声明一次 `dsh.client`，host 把声明扫描进 boot 图，同一套 Loader 语义在两侧治理 entry。

第一代 client loader（`createClientLoader`）把这两层手写进了同一个函数。这一融合留下的是：没有卸载/重载路径（装载一次性，style 标签从不移除）、在三个文件间人肉抄写且早已漂移的依赖清单、一条供跨插件 import 走的模块表后门——既复制了 cordis 的服务机制，又把装载顺序变成正确性约束。下文的结构取代了它。

## Decision

### 包成员与模块请求

[Client 外壳分层 Note](2026-08-15-client-shells-and-dynamic-packages.zh.md)定义当前的静态、动态包集合及其 import 规则。装载机件把每个 `dsh.client` 包视为一个 host graph row，且每个包只有一个普通 `lib/client.js` factory bundle。包声明携带 Cordis `inject` 边、同步模块表 `external` 请求，以及可选的 `immediately` 预取标记；负责组合的 app 只拥有挂载名册。

Web 内核保持不依赖框架，也不 import 任何动态包实体。Modules 本身是动态图 row，但 host parser 会在 Vite 主模块前送达其普通 factory。内核调用 `create()` 时，由 HTML 安装的 `__ModuleLoader__` facade 使用该 factory 构造模块系统。Runtime 经同一个 pending queue 到达；React、Cordis 与静态 UI 库的身份由外壳 seed 提供。

### 一套模块系统，一个插件治理器

浏览器复刻 host 侧的分工。`dsh-client-modules`（`ClientModuleSystem`）坐上 host 侧由 Node 内部 ESM loader 占据的模块系统席位；同一份 vendored `@cordisjs/plugin-loader` 在两侧都坐治理席。二者的分界线一句话说尽：**模块系统拥有模块身份与字节——代码怎么到达、怎么登记、怎么变成导出内容；Loader 拥有插件生命周期——插件何时挂载、等待什么、如何拆除。**

`ClientModuleSystem` 是一张 lazy CJS 表。执行 bundle 只**登记**其 factory——bundle 调用 `window.__ModuleLoader__.load({ id, factory })`，此外什么都不发生。模块体的一切副作用（包括 CSS 注入）都住在 factory 闭包里，在物化时运行：物化即该 id 的首次 `require`/import，此后记忆化。Import 和 prefetch 会先递归登记已声明的动态请求，再登记消费者；随后 factory 会同步物化任何已登记但尚未物化的请求。模块表按固定分支顺序解析：seed word → 记忆化记录 → graph row classic-script 登记 → 已登记 factory 物化 → 大声抛错。Modules factory 是自举例外：HTML facade 先物化它，构造过程再把同一 exports 直接写入记忆化表。最后这一抛是构建期纯度门禁在运行时的镜像。系统还保管逐模块簿记——名下 `<style data-plugin>` 标签 id、观测到的 require 边——并暴露 HMR（热模块替换）需要的两个动词：`prefetch(id)`（登记所请求的动态 factory 和本 row 自身的 factory；并发到达共享一个任务）与 `invalidate(id)`（丢弃非 bootstrap factory 与记录，下次到达即重新加载）。

vendored Loader 经其 `internal` 约定消费模块系统——唯一调用点是 `tree.import`——并拥有一切 entry 形状的事务：entry 创建、fiber 经 cordis 服务等待的激活（注入的服务未就位即保持 PENDING，服务 provide 时级联激活）、update/refresh、拆除。治理代码按 vendor 政策与 host 侧逐字节相同。浏览器化是壳 vite 配置里的编译期映射：一个 `node:module` stub 别名加若干 `process.*` define，使 `ModuleLoader.fromInternal()` 返回 undefined——这正是留给壳来填的空槽。模块系统挂载为 `ctx.modules`。

### 外部脚本到达与源码映射

每个图行的 `url` 交给一个带 `async` 的同源外部 classic `<script src>`。浏览器拥有网络请求与脚本执行；`load` 或 `error` 结算后节点立即移除，避免 HMR 累积失效节点。成功结算还要求图行对应的工厂 id 已出现在模块表中，否则到达失败；登记仍不运行工厂，副作用边界继续落在首次物化。

共享 tsdown 预设为每个插件产出 `client.js.map`，并把第一方源码路径重写成浏览器可识别的仓库形状 `/packages/<group>/<package>/src/...`。内联进 bundle 的其他 workspace 源码同样回到其 `packages/` 归属，依赖包路径保持原样；`sourcesContent` 承载源码，因此 host 只需在 `/plugins/<id>/client.js.map` 供给 map，无需开放源码路由。Vite 壳也产出 sourcemap，使壳代码与图外插件都能从 stack 和性能 profile 回到 TypeScript/TSX。

`rev` 继续作为脚本 URL 的查询参数和内容一致性锚点，bundle 与 map 都以 `no-cache` 供给。外部脚本的 `error` 事件不给响应状态与正文，因此失败诊断只报告 URL；同源 host 供给与构建期写入的 registration id 是身份边界，`load` 后的工厂存在性检查负责拒绝未登记预期 id 的产物。

### 装载流程，端到端

从 `dsh web` 启动到 UI 出现之间发生了什么？三个阶段：host 组合 graph 并由 parser 预载 bootstrap factory，HTML facade 创建模块系统且外壳执行预取，然后 Cordis 编排。

**host 侧——组合这张图。**

1. 负责组合的 app（`apps/cli`）把名册作为普通行放进它的 `cordis.yml` 配置树——client 插件包与每个 host 插件一样是 entry 行，包括无条件挂载的 `client-hmr` 行。名册行 import 失败由 `assertEntriesLoaded` 捕获；fiber reject 的行则由 `assertEntriesActivated` 报告原始 stack（[host boot 决策](2026-07-24-web-config-tree-boot-and-transport-layering.zh.md)）。
2. `dsh-client-modules` 的 node 半（该包是双面的：浏览器半就是模块表）扫描 loader entry 的 package.json `dsh.client` 声明，组合出 `window.__DSH_BOOT__`：`{ rev, entries: [{ id, url, rev, inject?, immediately?, external? }] }`。三个可选字段都来自 manifest，永不人肉抄写。组合会把被请求的动态图 row 排到消费者之前，并拒绝同步请求环。它会拒绝没有已构建 `./client` bundle 的已声明插件，并把它们的 package/path 行归到一条源码构建要求下；畸形声明字段同样会让激活失败，host 检查会从 FAILED fiber 报告这两类错误。
3. 扫描是单包增量——不存在全量重扫代码路径。每次 cordis `internal/plugin` 发射把该 fiber 的 entry 名标脏（无 entry 的 fiber O(1) 丢弃）；微任务 flush 把每个脏名对账 live loader entries，包元数据（含「非 client 包」的否定结论）按名永久缓存，bundle 重哈希只经 `rebuilt(id)` 可达。激活趟从当前 entries 灌同一脏集合并同步 flush，初扫与稳态共享一条实现。每个 bundle 的内容哈希是其 `rev`（缓存失效 + HMR diff 锚点），行集合哈希进 `graph.rev`，每一行都作为脚本资源供给：`/plugins/<id>/client.js?rev=…`，对应 sourcemap 位于同一路径加 `.map`。图类型单源在 modules 包的 `./client` 出口——webserver 对图一无所知（它是朴素路由注册插件；bundle 路由和 index 渲染 tap 都由 modules 自己注册）。

为什么名册是 yml 行而不是扫描？因为哪些插件组合进一次部署是组合决策，不是包属性——一个在仓库中声明了 dsh.client 的包，不代表这次部署要挂载它，扫描发现无从替人做这个决定；node 半只扫描配置树实际挂载了的东西。

**第一阶段——模块面。**注入的 HTML 以 queue 模式安装 `window.__ModuleLoader__`，以阻塞式 classic script 执行 modules 与 runtime graph row，赋值 `window.__DSH_BOOT__`，然后启动 Vite 主模块。内核把原始图和外壳 seed 传给 facade 的 `create()`。Facade 移除 modules registration，用拒绝全部 external 的 bootstrap `require` 将其物化，再调用其 `createClientModuleSystem` 导出。Modules bundle 解析图、构造系统、记忆化自身 exports，并在模块闭包中保留该实例；构造过程先把同一 facade 切换到 live registration，再排空 runtime 的 pending factory。随后内核并行预取每个 `immediately` row；prefetch 会递归登记已声明的动态请求和 row 自身，但不物化任一项。单行预取失败在这里被吞下，因为第二阶段 import 会重试并拥有那次大声失败。`immediately` 仍是到达标记，不是生命周期屏障或包身份。

**第二阶段——插件面。**

1. 内核挂载 vendored Loader，在任何 entry 存在之前就把模块系统注入为 `internal`。顺序有讲究：`tree.import` 的裸 import 兜底分支在浏览器里绝不能跑到。
2. 它统一创建每个 graph row。Import modules row 会返回记忆化的 bootstrap exports，其 `apply()` 把闭包中的系统提供为 `ctx.modules`；需要该 service 的 row 会保持 PENDING 直至此时，因此 modules row 无需特殊创建位置。渲染组装是由 `dsh-client-ui-renderer` 提供的普通 host graph row；内核不追加组装伪 entry。
3. Graph 顺序治理同步 factory 可用性；Cordis 激活与之独立，仍经服务等待推进。
4. `settled` = 每个 entry 已创建 + `loader.await()` 完全停稳 + 一次全 ACTIVE 扫描。扫描列出每个 import 失败、FAILED 或 PENDING 的 fiber 及其缺失的服务。它存在的理由：cordis 的 inject 等待没有超时——这次扫描就是大声失败的兜底线。
5. 不依赖框架的 loading 页经 `internal/status` 投影真实 fiber 状态。检查完成后，内核调用 `ctx.uiRenderer.mount(container)`，一次切换到真实 UI。

### 热重载：一个驱动插件，自行监视的 bundle

热重载是一项组合决策：web 组合包无条件挂载 `client-hmr` 行（一个常规的插件包），其 node 半带来 bundle 监视与 SSE（Server-Sent Events）通道；没有重建 watcher 改写客户端 bundle 时链路保持空闲。不应暴露它的组合可以禁用该行。

重建好的 bundle 怎么变成重载信号？hmr 的 node 半自己观察——没有构建器来通知它。它从 `ctx.clientModules.clientPath(id)` 读取图上各行的 bundle 路径，由 HMR 自持的单个定时器对当前图上的每一行做 stat 轮询。新增图行时，顺序固定为先同步取得 stat 基线，再立即调用 `clientModuleHost.rebuilt(id)`：在模块 host 算出图哈希之后、取得基线之前发生的写入会被这次立即重哈希捕获；取得基线之后发生的写入则会留下 stat 差异，供下一次轮询捕获。这避开了 `fs.watchFile`：它以异步首次 stat 建立基线，可能把构造期间的重建静默吸收进基线。监视集合的成员随 `onGraphChanged` 更新；消失的行撤下监视，轮询时缺失的 bundle 则让对应行保持标脏状态，文件重现时即使元数据相同也强制重哈希。mtime/size 变化或行处于标脏状态时，`clientModuleHost.rebuilt(id)` 是重哈希的唯一入口；当 `rev` 真的变了，node 半才在 `GET /plugins/events` 上广播 `rebuilt` 帧——这是一条系统级 SSE 通道，连接即发全量图，变更时发 `rebuilt` 帧，仅供呈现的 wire，永不进会话日志。轮询是刻意选择：inotify 在 weka 网络挂载上不触发，构建侧监视器需要 `--poll` 也是同一原因；轮询间隔是一个经校验的配置字段（默认 500ms），dispose（资源释放）会清掉那一个定时器。重建 bundle 则是任意一个 tsdown watch 进程的事——`scripts/dev-web.ts` 仍作为 watch 构建入口保留，其包清单在启动时扫描 `packages/*/*/package.json` 按 dsh.client 发现——构建器与 host 共享零协议。写一半的 bundle 被撕裂读取会自愈：写入完成期间 stat 持续变化，下一个轮询节拍会再次重哈希并广播最终的 rev。

浏览器侧，驱动插件每帧重载一个插件，串行执行：

1. `invalidate`——丢弃陈旧的工厂与记录。工厂还活着会让下一步变成 no-op。
2. `prefetch`——加载外部脚本并登记新工厂，旧 fiber 此刻仍在服役。
3. `registry.delete`——先于任何 fiber 操作。裸做 fiber dispose 会触发 vendored Loader 的自 dispose 分支，把 entry 永久停用。
4. 排空旧 fiber 的各 disposer。
5. 移除名下的 `<style data-plugin>` 标签。
6. `entry.refresh()`——重新 import，物化新工厂。CSS 在这里重新注入，沿用同一批稳定标签 id。
7. `fiber.await()`——让失败大声重抛。

每个插件都共享同一套语义；`immediately` 行的重载与 lazy 行分毫不差。依赖级联不花一行 client 代码：fiber 的激活纪元串接着它各服务提供方的 uid，因此换掉提供方的 fiber，每个依赖方都会经 cordis 本身重新装载。重载 connection 或 runtime 会级联整个 UI——正确，虽然重。

支持边界，如实陈述。重载粒度刻意做粗：全新 fiber、全新组件、React 状态丢失、数据层不动——react-refresh 级的状态保留与「重执行 bundle 即重跑 factory」相冲突，属刻意不做。静态装配包与外壳内核不是 entry：改动它们意味着外壳重建加整页刷新。重载不做回滚：import 失败让 entry 失去 fiber，下一个 rebuilt 帧从头重试；apply 失败留下 FAILED fiber 交给状态投影；两者都大声记录。自我重载可行——在途的重载在旧 bundle 的闭包里跑完，新的 apply 再开一条新 SSE 通道——但空窗期到达的帧会丢失，下次重建会再次通知。一处已知的仅限 dev 竞态：rebuilt 帧与仍在途的 boot 到达重叠时共享那次到达的任务，可能物化重建前的字节；下一帧自愈。

## 包归属

当前包盘点与构建形态位于[client 外壳分层 Note](2026-08-15-client-shells-and-dynamic-packages.zh.md)。本 Note 只保留适用于每个动态图 row 的装载属性：惰性 factory 登记、Cordis entry 治理、外部 script 到达、sourcemap 与 HMR。

## Consequences

Wire 两侧运行同一份治理实现；浏览器特有层只包含一套模块系统和一个重载插件。动态包只有一种产物形态，因此纯度检查覆盖全部动态包。Cordis 依赖、模块请求与启动档位都与其所有者——manifest——同住，负责组合的 app 只握名册。Host graph 校验与递归请求到达使同步 factory 依赖保持显式。浏览器原生 script 装载保留插件网络资源、生成 bundle 与 TypeScript/TSX 源码之间的标准映射，模块系统也只保留一个可替换的 `loadBundle` 钩子。

接受的代价：vendored Loader 在浏览器里背着闲置机件（EntryTree 持久化是 no-op，分组／隔离未用）；开发期每次修改插件都要付一次 bundle 重建加 fiber 重挂；graph `inject` row 仅是信息性说明——激活的真相在服务层——因此不匹配会在 settled 扫描时浮出，而不是在 graph 校验时被拦下；静态 UI 库保留直接实体导出；每个 bundle 多出一份 sourcemap 产物，外部 script 失败也只能给出粗粒度 URL 诊断，不能像显式 fetch 那样报告 HTTP 状态。

名册位于 web 组合包的配置树（`packages/bundle/web-app/cordis.patch.yml`）；`mountWebPlugins` 与 `CLIENT_PACKAGES` 常量已消失，重组一次部署等于替换 yml/overlay。Graph 组合器位于 `dsh-client-modules` node 半，由 parser 预载的 client face 则自举浏览器模块表。Webserver 继续作为朴素路由注册插件；`/api/*` 绑定属于 connection node 半，并经 `api-gateway`（由 `dsh-host-apiproxy` 提供 `ctx.apiProxy`）；开发期 bundle 监视与 SSE 通道属于 hmr node 半。

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| 两轴分类体系（entry × 到达），基础设施包不带 dsh.client | 抹掉了 manifest 依赖边（inject 泄漏给组合方）、把插件形态拆成两种、让纯度门禁对一半插件失明 |
| 继续把手写 loader 演化成治理器 | 重新实现 vendored Loader 已拥有的 entry/fiber 生命周期；HMR 将与 host 侧毫无共享骨架 |
| 在浏览器复用 `@cordisjs/plugin-hmr` | 约 80% 在解决浏览器没有的问题（fs 监听、深度图着色、Node 的双缓存）；只按形状抄用其重载骨架 |
| 模块联邦（module federation） | 独立构建的远端 bundle 恰是 vite 联邦不支持的形态 |
| import map | 早已排除；DI require 表是终局机制 |
| 现在就彻底 ctx 化（React 与库全走服务，不设模块表） | 静态 UI 库仍暴露同步实体，因此删除模块表会让这些 import 失去共享身份 |
| 冻结表 + 到达即实例化 | 会在 script 到达时执行 bundle 副作用；惰性登记把执行推迟到 Cordis import，并由递归 `require` 物化已登记请求 |
| fetch 响应文本后注入内联 `<script>` | 模块系统必须缓冲整份源码并维护 fetch/execute 两条路径；动态源码执行也切断浏览器网络资源、sourcemap 与 profile 的原生关联 |
| 构建器推送重建通道（编排器在 `onSuccess` 里 POST `/plugins/rebuilt`） | 把重载耦合到一个钦定的构建器进程和第二套 wire 协议；webserver 本就握有每个 bundle 路径，stat 轮询（每次 stat 变化即重哈希）已兜住当年为推送辩护的撕裂写竞态 |
