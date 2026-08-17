# Agent Note: 单一侧栏脚部动作座位——移除专用远程座位

Status: implemented

[English](2026-08-18-single-sidebar-foot-action-seat.md) | 中文

> 范围：为什么 `ui-sidebar` 不再声明专用的 `'sidebar.remote'` 脚部座位，只在设置旁保留通用 `'sidebar.footer.action'` 列表。遵循[槽位系统标准](2026-07-22-slot-type-chain-implementation.md)；反转了 [Web UI 槽位与 dsh-web-ui 兼容层](2026-08-14-web-ui-slot-seats-and-compat-shim.md) 中的座位部分。

## 问题

安装社区 dsh-web-ui 全家桶（`@linxin666/dsh-web-ui-all`）后，移动端远程入口在设置触发器上方出现两次：shell 同时声明了 `'sidebar.remote'`（专为该插件的配对入口而加）与通用 `'sidebar.footer.action'`，而已发布的插件把它的入口注册进两个座位——那是为「shell 只声明其中一个」而写的回退模式。在第二个座位出现之前构建的 shell 上插件只渲染一次，这正是终端跑旧构建看起来正常、桌面端（带两个座位的新 shell）出现两排的原因。任何用户在双座位 shell 上安装该家族都会看到重复；而且 shell 内部没有任何手段能阻止第三方插件往它声明的两个座位里各注册一次。

## 决策

从 `ui-sidebar` 移除 `'sidebar.remote'` 座位：`contract/slots.ts` 里的 SlotMap 条目与 owner 类型、`src/client/index.ts` 里的 `children` 声明与类型导出、`SidebarRoot.tsx` 里的专用脚部行、`remoteArea` CSS 规则，以及重新生成的面向模型的客户端槽位目录。脚部保留 `'sidebar.footer.action'`——已发布插件在 `'sidebar.remote'` 未声明时本来就回退到它——因此任何已发布插件版本在新旧 shell 上都恰好渲染一次。刻意选择在 shell 侧修复：插件是第三方 npm 产物、本仓库无法替它发版，而槽位面是 shell 权威。

## 备选方案

**在上游修复插件的互斥检查。** 在注册回退前先查 `ctx.slots.spec('sidebar.remote')` 是正确的长期形态，但它位于本发行版无法发布的第三方仓库；等待意味着在下一次插件发布前所有现网用户都继续看到重复。移除座位与上游修复兼容：一旦上游发版，插件的回退只是往 `'sidebar.footer.action'` 注册一次。

**给槽位系统加跨座位去重。** 否决：注册 id 是座位内的，跨座位身份会让槽位核心决定谁能渲染什么；而一个插件合法地往不同座位注册多个条目是有效模式。

**保留座位、用文档要求注册者互斥。** 否决：文档约束不了第三方 bundle。

## 后果

- SlotMap 失去 `'sidebar.remote'`；指向它的第三方注册会永远等待，必须改用 `'sidebar.footer.action'`。已发布的 dsh-web-ui 家族已有该回退，因此移动端远程入口在展开侧栏与窄栏中都恰好渲染一次，位于设置正上方。
- 每个部署的 DOM 里少了一行空的脚部行；它在未占用时本就不渲染内容，因此未安装插件的部署看不到任何视觉变化。
- 面向模型的客户端槽位目录（`cordis_inspect what:"client"`）重新生成后不再包含该座位。
- [2026-08-14 槽位笔记](2026-08-14-web-ui-slot-seats-and-compat-shim.md) 已就地更新：shell 现在只声明一个社区座位 `'conversation.input.selector.context'`。

## 测试

- `ui-sidebar` apply 规格断言不含远程座位的 children 声明与卸载清理；sidebar-root 规格移除远程座位夹具，保留脚部动作座位在宽/窄状态下的 wide 标志断言。
- 三个 `sidebar-snapshot` 快照重新生成，不再含 `data-slot="sidebar.remote"` 行。
- 客户端槽位目录重新生成（`gen-client-catalog`）并通过校验（`verify-client-catalog`）；其消费方（`cordis-client-runner`、`tool-cordis`）119 个测试通过。
- `pnpm run test:gui` 通过（300 个文件、4134 个测试），全仓类型检查干净。

## 相关

- [Web UI 槽位与 dsh-web-ui 兼容层](2026-08-14-web-ui-slot-seats-and-compat-shim.md)——最初声明本次移除的座位。
- [内置 webui 精简、安装期产品冲突禁用、归档搜索与多选](2026-08-15-webui-suite-trim-and-archive-selection.md)——早前针对另一处重复入口来源（内置全家桶 + 用户自装）的修复。
- [槽位系统标准：类型链实现](2026-07-22-slot-type-chain-implementation.md)
