# Agent Note: 内置社区插件与 profile 范围开关

Status: implemented

[English](2026-08-14-built-in-community-plugins-and-controls.md) | 中文

## 问题

随发行版提供的 Web profile 原先只包含仓库自有的 base 与 Web 组合包。想使用生成式 UI、文本选择批注或社区 Web UI 集合的用户，必须自行发现并安装每个包，但本发行版希望把这三个产品作为默认体验的一部分。Settings 已提供配置与只读 Loader 清单，却没有一个范围受限的控制界面，让用户无需编辑 YAML 即可停用发行版自有产品。

通用 Loader 修改端点会使每个已安装行都能被远程寻址，把部署策略与清单混为一体，并继承第三方插件的 teardown 行为。实时停用再启用不能作为普遍承诺：插件可能注册路由、工具或 DOM 资源，却不返回生命周期 disposer；再次激活就可能与首次激活遗留的注册冲突。

## 决策

`web` profile 模板按顺序包含两个组合包：`@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app`。三个社区产品随发行版提供但默认关闭——这一反转及其迁移由[社区插件默认关闭笔记](2026-08-14-community-plugins-opt-in-by-default.md)持有。两个 Git 包锁定到确切 commit，npm 聚合包锁定到 `0.1.2`；lockfile 记录源码获取结果。`dsh-web-app` 组合包还直接把聚合包的九个入口包与 whale-song 皮肤包声明为同样锁定 `0.1.2` 的直接依赖：pnpm 的隔离布局不会把嵌套依赖放到组合包自身的 `node_modules` 上，而 profile 模块回退目录只镜像安装闭包中可从每个锚点解析的包，因此只有直接声明才能让 Loader 从 profile 目录解析这些入口行。旧五组合包模板列表归安装所有，并会向下迁移为双组合包模板；任何自定义 bundle 列表仍归用户所有。本功能使用既有 profile bundle 机制，不会恢复已移除的 repository-Plugin 路径。

dsh-web-ui 0.1.2 的皮肤中心假设 `skins/` 目录位于其 checkout 布局里（`packages/skins/<id>`），任何打包部署都没有这个目录，因此试穿与应用都会以 ENOENT 失败；其 0.1.2 聚合包也没有把皮肤行装进组合层（`skin.json` 的 `bundleWired: true` 与 npm 发布内容不符），所以即使重启，受管区段也不会挂载任何皮肤行。本发行版以四处弥合这个上游缺口：用 `patchedDependencies` 给 `@linxin666/dsh-client-ui-skin-center` 打补丁，让它在原始位置不存在时沿祖先目录向上查找 `skins/`；补丁同时让受管区段总是插入当前皮肤的插入行，并在应用接口成功后直接对运行中的 Loader 树做 live reconcile（挂载当前皮肤行、禁用其余行）——打包 Electron 无法提供 Cordis HMR 的 loader internals（`node-addon-require-builtin` 在 Electron 下不可用），而桌面版禁用 patch watcher，所以 live reconcile 是应用即时生效的唯一通道；`scripts/link-community-skins.mjs` 在 postinstall 时把安装好的皮肤包链接成工作区根 `node_modules/skins/<id>`（源码启动用）；桌面打包在 stage 时把同样一组皮肤装进 `skins-extras`，经 `extraResources` 落到 `app/node_modules/skins`（打包应用用）。whale-song 已发布但不在聚合包依赖里，而 0.1.2 的客户端注册表已列出它，因此把该包声明为直接依赖后皮肤中心七张卡片全部可用。

Web 组合包声明三个逻辑控制项：GenUI 的一个 Loader 行、Annotation 的一个 Loader 行，以及作为 dsh-web-ui 整体移动的九个行。`@deepseek-ai/dsh-host-plugin-control` 在仅限回环访问的通用 Connection 通道上暴露 `list` 与 `set-enabled`。由部署方拥有的清单就是完整的修改允许列表；每个 profile 本地 id 必须恰好解析为一个已挂载 Loader 条目。gateway 从不接受任意清单 id；逐条目的启用能力后来移入 plugin-inventory Remote，浏览器开关页也并入了[插件列表页](2026-08-15-merged-plugin-list-tab.md)。

每次修改都会把受管 `{id, disabled}` patch 写入当前 profile 的 `cordis.patch.yml`，并用 `# dsh-plugin-control: <control-id>` 注释标记。文件锁与原子发布会串行处理并发写入，并保留无关 YAML 节点、注释及 `!!js` 表达式。启动器会在配置行挂载前以 `ctx.profileUserPatchPath` 提供确切的 profile patch 路径，因此 Host 插件不需要从环境中的 home 状态推导路径。

开关属于重启时设置。gateway 返回已保存的期望状态，但不修改当前 Loader 树；下一个进程通过普通 profile 层顺序应用设置。这样既能支持第三方插件，也不声称其 teardown 可逆。home 级 patch 与命令行 overlay 仍保留后应用的优先级。

`@deepseek-ai/dsh-client-ui-settings-plugin-control` 曾通过既有 slot 记录贡献第三个 `settings.plugins.tab` 条目：**插件开关**。它只在首次选择时懒读取状态，为每个逻辑产品渲染一项带源码归属的可访问开关，远程浏览器绝不调用特权路由，并明确告知用户更改成功后需要重启。合并后的插件列表页（见[合并列表记录](2026-08-15-merged-plugin-list-tab.md)）后来移除了这个浏览器标签页；Host gateway 仍为配置了目录的 profile 保留。

## 备选方案

**把三个项目复制或 fork 到本仓库。** 否决，因为用户指定的项目已经发布可安装的 profile 组合包。锁定其上游包可以保留归属，并让项目所有者继续负责实现与发布。

**在“插件列表”中为每一行暴露启用／停用。** 当时否决，因为清单无法说明哪些行共同组成一个产品，而不受限的修改端点会把浏览器权限从三个发行版选择扩大到整个部署树。合并后的插件列表记录后来接受了用户与内置条目的逐条目启用，同时这里保留按产品分组控制；权限扩大由桌面用户持有，列表 Remote 校验唯一挂载。

**写入 patch 后立即更新 Loader。** 真实 Web 组合证明一种有效的第三方生命周期可以停用却无法重新激活，并会产生重复路由，因此否决。重启时规则对所有 profile 组合包都具有确定性，也避免产品处于部分重载状态。

**把设置存入独立 JSON 文件。** 否决，因为 profile patch 已是权威的用户自有层，会参与 dump 与 HMR 语义，并使下次启动无需引入另一配置来源即可检查。

**使用 Typert 执行修改。** 否决，因为既有生成清单命名空间刻意保持只读且与传输无关。通用 Connection 通道已经承载按信任范围限制的浏览器到 Host 命令，无需扩大 API 图。

## 影响

新的、迁移后的库存 Web profile 只挂载内置插件；三个社区产品随发行版提供但默认关闭，经安装器启用。与旧随附模板列表完全一致的现有 profile 会向下迁移；自定义 profile 不会意外新增或丢失配置层。根目录双语 README 会明确致谢源码包与 LINUX DO，生成的第三方声明则记录其许可证。

Settings 仍只有一行“插件”导航。此前的功能自有标签页决策仍是 slot 架构权威；其具体名录先由本记录扩展，后被[合并插件列表记录](2026-08-15-merged-plugin-list-tab.md)合并——移除了开关页与清单页，并增加独立的特权逐条目能力。

profile 组合包与移除 repository-Plugin 的记录仍是有效基础。本功能使用有序 bundle 依赖作为唯一外部分发路径，不增加源码缓存、包装格式或第二套安装器。

GenUI 与 dsh-web-ui 可以改变模型可见的提示词与工具，Annotation 则在使用时加入模型可见内容。因此停用产品会改变下一个进程的请求前缀或工具名录，并在重启后开始新的 KV cache 前缀。

## 测试

Host 聚焦测试覆盖清单校验、回环注册、聚合状态、串行原子 YAML 写入、取消、无效 YAML、不可用控制项，以及无关节点保留。浏览器包测试覆盖 slot 生命周期、本地化、响应校验、可访问性、远程权限、重试、修改失败与延迟结算。Profile 测试覆盖双组合包模板、旧五组合包向下迁移与自定义列表保留。无密钥 Web 浏览器回放会启动真实双组合包组合、快照显示内置区段折叠的插件列表页；开关写入路径仍由 Host 单元测试覆盖。
