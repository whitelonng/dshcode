[English](README.md) | 中文

# dsh-client-ui-settings-plugin-installer

Web 插件设置中的合并插件列表标签页（`settings.plugins.tab`，id `plugins`）。该标签页提供：

- **安装** —— 从 npm spec（`name`、`name@version`、`name@range`）或 git 仓库 URL 把插件安装到 profile 的共享模块 fallback；宿主把来源记录到 `$DSH_HOME/plugins.json`，并向 profile 用户 patch 层插入 loader 行。
- **检查更新** —— 把已安装版本与 npm `dist-tags.latest`（git 来源则为远端 HEAD）比较，逐行显示更新徽标。
- **更新** —— 从记录的来源重新安装并刷新列表。
- **卸载** —— 需要确认，然后删除安装目录、patch 行与状态条目。
- **启动失败** —— 有启动失败记录（`$DSH_HOME/boot-failures.json`）的插件显示徽标与失败摘要，并带两个动作：**让 Agent 修复** 打开一个新对话，其工作区为插件安装根目录（`$DSH_HOME/profiles`），首条消息内嵌失败记录与安装路径，Agent 即可在工作区边界内修改插件代码；**复制错误** 复制失败文本，供用户手动新建对话修复。
- **安全模式** —— 桌面端跳过用户 patch 层运行时，横幅说明插件开关不可用，并提供 **恢复正常模式并重启**，该动作清除安全模式标记并重启应用。

安装、更新与开关切换结束后有重启入口：桌面壳中 preload 桥会原地重启应用（`window.dshDesktop.restart()`）；浏览器中提示需要重启 `dsh web` 进程才能生效。

## 模型体验

### 浏览器插件标签页

#### 模型看到的内容

`plugins` 标签页本身不产生任何模型可见内容。本标签页不发起模型请求，也不注册任何面向模型的内容；宿主从配置的 npm registry 或 git 远端下载包。修复动作创建的是普通用户对话，其首条消息内嵌失败记录——该消息与其他用户消息一样对模型可见。

#### Token 影响

当前进程内为零；修复对话只在用户发送后消耗 token。

#### KV Cache 影响

当前进程内无影响；本标签页不会给任何提供方请求带来变化。

## 已知限制与延期工作

- git 来源需要本机存在 `git` 二进制；npm 来源经 HTTPS 下载，尚无完整性固定（integrity pinning）。
- 更新检测仅做来源比较（`dist-tags.latest` / 远端 HEAD）；npm 范围解析从不选择预发布版本。
- 安装任意包意味着重启后以完整宿主权限运行其代码——UI 通过重启流程隐含提示；安装前请审查来源。
- 修复对话就地修改已安装副本；之后的重新安装或更新会覆盖修复内容。
