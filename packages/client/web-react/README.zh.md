---
description: "slot 终端设计的外壳侧 React 胶水：外壳安装到运行时 SlotRegistry 的 SlotRenderer 实现、框架接入的 SessionProvider seat、bindSnapshotSelector 钩子构造器，以及链式 slot outlet 渲染。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-web-react

[English](README.md) | 中文

## 概述

slot 终端设计的外壳侧 React 胶水。`createSlotRenderer` 是外壳安装到运行时 SlotRegistry 的 SlotRenderer 实现；`SessionProvider` 是框架接入的 render prop，作为标准 seat 注入到声明会话 scope 子 slot 的配置项；`bindSnapshotSelector` 是唯一的钩子构造器——主机与引擎只传递裸 observable source，每个钩子在此绑定并按 source 缓存；`useInvoke` 驱动连接的 invoke 路径。链式 slot outlet 在渲染时按链顺序运行已注册 selector，只挂载被选中的配置项。快照 store 引擎与 `defineStore` 位于运行时；业务插件只依赖 `ui-slots` 类型，绝不依赖该包。

## 目录

- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [延伸阅读](#延伸阅读)
- [模型体验](#模型体验)
- [已知限制与暂缓事项](#已知限制与暂缓事项)
- [开发备注](#开发备注)

-----

<a id="使用本包"></a>
## 使用本包

外壳把本包作为客户端装配的一部分来组合；业务插件绝不直接导入它。

### 何时选择它

当实现一个 slot 终端、需要 harness 把裸 observable source 绑定到 React render prop 时选择本包。若是无 ctx↔React 集成的静态组件库，`ui-primitives` 提供普通组件导出，此时不必使用本包。

### 最小配置

无需挂载：本包不向任何组合注册内容。外壳把 `createSlotRenderer` 安装到运行时 SlotRegistry，并经标准客户端装配声明 SessionProvider seat。

-----

<a id="理解实现"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`createSlotRenderer` 构造外壳注册到运行时 SlotRegistry 的 SlotRenderer。`SessionProvider` 是框架接入的 render prop，也为声明会话 scope 子 slot 的配置项充当标准 seat。`bindSnapshotSelector` 是唯一钩子构造器——主机与引擎把裸 observable source 交给它，它对每个 source 只绑定一次并缓存。链式 slot outlet 在渲染时按链顺序评估已注册 selector，只挂载被选中的配置项，其 select 返回值以 `matched` 加入 props；`renderSlotChain` 绑定与 `renderSlot` 一样按配置项缓存。快照 store 引擎与 `defineStore` 留在运行时而非本包，因此本包不携带自己的 store 注册表。

</details>

-----

<a id="延伸阅读"></a>
## 延伸阅读

- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)
- [Slots 参考](../../../docs/subsystems/slots.zh.md)
- [客户端 store 原语](../../../packages/client/store/README.zh.md)

-----

<a id="模型体验"></a>
## 模型体验

无。ctx↔React 机制完全在浏览器中运行；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

<a id="已知限制与暂缓事项"></a>

- **persist 中间件会损坏原始值状态 store**：保存时它会对状态执行对象展开，因此 `SnapshotStore<string>` 往返后会变成字符映射；引擎改为自行实现持久化（见 `attachPersistence`）。
- **`UseSession` 有意保持宽泛（`object` 快照）**：依赖方向（runtime → web-react，绝不反向）使真实 `ConversationSnapshot` 类型不可访问；会话 slot 消费方在其边界处缩窄一次。
- **`renderSlot` 是唯一的渲染形式**：没有 Suspense 集成或逐配置项惰性加载。

<a id="开发备注"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
