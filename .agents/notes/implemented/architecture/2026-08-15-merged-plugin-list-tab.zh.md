# Agent Note: 合并后的插件列表页与逐条目启用控制

Status: implemented

[English](2026-08-15-merged-plugin-list-tab.md) | 中文

## 问题

Plugins 设置分区有三个并列标签页——安装与更新、插件开关、Loader 清单——其中开关页与列表页展示了重复的启用信息。已安装的用户插件没有启用开关，内置条目只读，而 npm registry 停滞时安装按钮会永久停留在“安装中”。

## 决策

`@deepseek-ai/dsh-client-ui-settings-plugin-installer` 现在拥有唯一合并后的 **插件列表** 标签页（slot id `plugins`，order 10）。用户区依次渲染：安装框、部署的预装产品（plugin-control 清单行，带开关与源码链接）、已安装的用户插件行——每行带已保存的启用开关、版本、更新可用性、更新与需确认的卸载。内置 Loader 条目留在下方，默认折叠、可搜索、只读（无开关）。`controls` 标签页与独立的只读清单标签页已移除；两个浏览器包（`ui-settings-plugin-inventory`、`ui-settings-plugin-control`）被删除，而它们的 Host 网关（`plugin-inventory`、`plugin-control`）仍为 profile 保留挂载。

启用状态的持久化只有两个所有者：

- `plugin-installer` `set-enabled { id, enabled }` 重写插件的受管 patch 项并写入 `disabled` 键；其创建的行保留 `dsh-plugin-installer:` 标记并放在 `insert` 项里，因为用户 patch 层把裸行当作对既有条目的补丁，id 尚未挂载的行会被静默跳过（最初的裸行格式从未挂载任何东西——这正是“安装后不生效”的修复）。
- `plugin-control` `set-enabled` 写入（或重写）一个带 `dsh-plugin-control: <id>` 标记的 `insert` 项，包含每个受管条目的 id 与模块标识；目录新增逐条目的 `packages`，因此启用从未挂载过的产品现在会创建其行，而不是以 unavailable 失败。行不存在投影为 `disabled`，歧义 id 仍是 `unavailable`。

已保存状态的唯一来源是 patch 层，而不是内存中的 desired map：`plugin-installer` 的 `list` 每次调用都读受管项（浏览器开关直接显示 `plugin.enabled`，不再与生成式条目 id 做清单 join），`plugin-control` 用 `desired` map 覆盖同进程反馈。安装器的持久化 `plugins.json` 保持格式稳定——`enabled` 按响应派生，从不落盘。

安装还新增 `status` 端点（`idle`，或 `fetch`/`download`/`extract`/`write` 并带可选的下载百分比），浏览器在修改进行中轮询并以进度条呈现；registry 请求带硬超时（元数据 30 秒、tarball 60 秒，并尊重调用方的 abort signal），网络停滞会以类型化错误呈现，而不是无尽的安装中状态。安装 spec 在发请求前校验（npm 包名格式或单个 git URL），粘贴的散文文本会得到可读的错误提示。

## 备选方案

**保留三个标签页，只合并列表与开关。** 拒绝，因为用户插件仍会出现在两处，安装/更新页仍是第三个重叠表面。

**让每个内置条目都能通过清单 Remote 开关。** 最初实现过，后因产品反馈回退：内置必须保持只读，因此 `plugin-inventory` 回到只读投影，逐条目修改端点被移除。

**用清单按条目 id join 已保存的启用状态。** 在发现 Loader 条目 id 带生成前缀后拒绝；安装器自己的 `list` 直接读受管 patch 项，权威且跨启动稳定。

**把 `enabled` 存进安装器状态文件。** 拒绝，因为启用状态由 patch 行派生；持久化两份会带来没有读者的陈旧风险。

## 结果

Plugins 分区现在只有两个标签页：配置卡片与合并后的插件列表。预装产品与用户插件可开关，用户插件另外支持更新与卸载；内置 Loader 条目只读。开关持久化在下次重启时生效，与既有的 plugin-control 契约一致。[特性所属标签页 note](../../archived/architecture/2026-08-11-plugin-settings-tabs.md) 保留 slot ledger 机制，但其标签页清单在此被取代；[社区产品与 profile 开关 note](2026-08-14-built-in-community-plugins-and-controls.zh.md) 的浏览器开关半部分同样被取代——`plugin-control` Host 行仍为配置了目录的部署保留，其目录现在会为从未挂载的产品创建行。
