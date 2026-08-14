# Agent Note: 社区插件随发行版提供但默认关闭

Status: implemented

[English](2026-08-14-community-plugins-opt-in-by-default.md) | 中文

> 范围：仅随发行版提供的 Web profile 模板及其安装自有迁移。反转了[内置社区插件笔记](2026-08-14-built-in-community-plugins-and-controls.md)的模板半边；该笔记仍是依赖、皮肤树与插件开关半边的权威，本变更保留这些部分。

## 问题

随发行版提供的 Web 模板默认挂载 `@omdsh-dev/dsh-genui`、`@omdsh-dev/dsh-annotation` 与 `@linxin666/dsh-web-ui-all`，导致每个库存 profile 都加载三个第三方产品。不想要的用户只能通过 profile patch 禁用行：移除最后一个组合包会把 manifest 改写成恰好等于安装自有元组的列表，而 `loadProfile` 会在下次启动时把该元组重新规范化为完整模板——「卸载」被静默重新安装。web-ui 聚合包还夹带了用户从未选择的 describe-image 行。

## 决策

随发行版提供的 Web 模板只包含两个内置组合包（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`）。三个社区产品仍作为随发行版提供的包保留——web-app 组合包保留其锁定版本的直接依赖（profile 模块回退解析）、插件开关卡片仍把它们列在控制目录中、安装器仍是挂载路径——因此产品是「已随发行版提供但默认关闭」，而不是从发行版中移除。

旧五组合包模板成为安装自有的 Web 元组：恰好携带该列表的库存 profile 会向下迁移为双组合包模板，除此之外的任何列表——包括双组合包列表本身——都归用户所有且不改动。这是既有无惊喜加层策略的反向应用。

在 profile 安装它们之前，三张插件开关卡片显示不可用且开关禁用；挂载走安装与更新标签页。用户 home patch 中 dsh-managed 的 describe-image insert 作为用户数据移除，不属于仓库行为。

## 备选方案

**仅在 profile patch 中禁用社区行。** 已拒绝：产品仍处于已安装状态，且一旦 manifest 回到安装自有元组，模板规范化就会重新加回；需求是卸载，不是禁用。

**从发行版中移除社区包。** 已拒绝：依赖、皮肤树与开关机制对想要这些产品的用户仍然有效，且随发行版提供使安装离线且保留署名。

**不改列表，改为增加模板开关标志。** 已拒绝：该标志与 profile manifest 已经持有的组合包列表重复。

## 影响

- 新建与迁移后的库存 Web profile 只挂载内置插件；社区产品显示为可安装卡片，安装前不可用。
- 恰好携带旧五组合包列表的既有 profile 向下迁移；自定义列表保持不变。
- web e2e scaffold 不再组合社区组合包层，plugin-controls golden 记录了不可用卡片。
