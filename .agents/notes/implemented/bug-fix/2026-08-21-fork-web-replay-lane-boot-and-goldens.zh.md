# Agent Note：fork web replay 通道的启动、品牌与 golden 修复

Status: implemented

[English](2026-08-21-fork-web-replay-lane-boot-and-goldens.md) | 中文

## 问题

fork 的 `web browser replay` 通道在 master 上因四个相互独立的原因而红,其中三个被掩盖了:所有 assembled-jsdom 快照文件在导入时即失败(`readProductVersion` 抛出 `TypeError: The URL must be of scheme file`),其后的测试根本没机会运行。掩在后面的还有:设置里的「插件」分区出现两个同名的 tab、replay 构建缺少 official 客户端 profile(导致 `built-boot` 的官方品牌断言不成立)、以及整条通道的 golden 因消息反馈按钮而漂移。

## 决策

**产品版本号读取改用 `import.meta.dirname`。** Vitest 4 的 module runner 通过 dev server 的 HTTP URL 提供根目录内的依赖模块,因此在 jsdom 通道里 `@deepseek-ai/dsh-client-modules` 内的 `import.meta.url` 是 `http://localhost:<port>/packages/client/modules/src/index.ts`,`fileURLToPath(new URL(…))` 直接抛错。`import.meta.dirname` 在 runner 与构建后的 Node 运行时里都是真实文件系统目录,同一跳 `../package.json` 读取在所有场景都成立。

**fork 的 replay 通道用 official profile 构建。** web job 现在设置 `DSH_BUILD_CLIENT_PROFILE: official`(与上游的兼容性冒烟一致),使 `ui-brand-official` 正常注册,`built-boot` 的字标 / `DSH Local Build` 断言成立。

**「插件」分区的两个 tab 获得不同文案与顺序。** 上游的 `ui-settings-plugin-inventory`(运行时 fiber 清单)与 fork 的 `ui-settings-plugin-installer`(合并后的管理列表)都向 `settings.plugins.tab` 注册了标签「插件列表 / Plugin list」。清单 tab 改名为「插件状态 / Plugin status」;安装器保留「插件列表」,因为 settings e2e 将其固定为管理界面。安装器同时改为 `order: 20`:两者原本都是 `order: 10`,分区的稳定排序随后跟随激活顺序决定的注册顺序,导致两个 tab 在不同环境间互换位置。

**加固的是场景时序,不是产品。** `message-feedback-layout` 的 `settleAt` 现在要求三次间隔 150ms 的相同列宽读数——相邻两次读数会在窄视口翻转落定之前、以及轨道缓动的零速平台上各达成一次一致。`settings-chrome` 的启动主题场景只挂起异步插件包:modules 与 runtime 行是解析器阻塞的 head 预加载,启动队列需要它们,挂起它们会隐藏 `<body>`,加载页永远不出现。

漂移的 golden 在 `DSH_SNAPSHOT=refresh` 下刷新,助手 IconActions 行上带上了 Good response / Bad response 按钮。

## 备选方案

**通过 vitest 插件修补 `import.meta.url`。** 在生产代码里放一个只服务测试运行器的转换以保住 `fileURLToPath`,会掩盖真实契约——vitest 的 runner 并不保证 `file:` URL——且下一个以 HTTP 提供模块的加载器仍会踩坑。

**删除 fork 的清单 tab。** 移除上游包的注册会让 fork 偏离上游包,并删掉 fork 随产品发布的运行时状态界面;区分文案则两个界面都保留,也不影响与上游的 merge-forward。

**让启动主题场景不挂起任何包、等启动完成后再断言。** 这放弃了该场景的初衷——证明持久化的深色偏好从首帧生效、先于插件加载——只换来一个更安静的测试。

## 后果

`client/modules` 中任何未来运行时读取 `package.json` 的代码都应沿用 `import.meta.dirname` 模式;新增代码不得假设 `import.meta.url` 是 `file:`。fork 的 web 通道要求 official profile,且 golden 现在编码了反馈按钮,重录时需要同样的 profile。两个插件 tab 按角色区分:「插件列表」用于管理,「插件状态」用于查看。
