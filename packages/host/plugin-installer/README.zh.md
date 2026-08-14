[English](README.md) | 中文

# dsh-host-plugin-installer

当前 profile 的仅回环插件安装与更新。网关（`/plugin-installer`）以 `authority: 'loopback'` 注册在 Connection 通道上，暴露：

- `list` —— 从 `$DSH_HOME/plugins.json` 读取已安装快照。
- `install { spec }` —— 从 npm spec（`name`、`name@version`、`name@range`）或 git 仓库 URL 安装。npm 包按配置的 registry（默认 `npm_config_registry`，其次 npmjs）解析，下载 tarball 并解压到扁平模块 fallback `$DSH_HOME/profiles/node_modules/<name>`；git 来源做浅克隆（需要 `git` 二进制）。安装后把插件记入 `plugins.json`，并向 profile 用户 patch 层（`cordis.patch.yml`）插入受管 loader 行——插件在应用重启后加载。
- `update { id }` —— 从记录的来源重新安装一个插件并刷新行。
- `uninstall { id }` —— 删除安装目录、受管 patch 行与状态条目。
- `check-updates` —— 把 npm `dist-tags.latest`（git 来源则为远端 HEAD）与已安装版本比较，不做任何变更；离线或已消失的来源按插件跳过。

所有变更串行化；状态文件在锁内原子写入，patch 层编辑保留每个非属主 YAML 节点、注释与 `!!js` 表达式。

## 模型体验

### 回环网关

#### 模型看到的内容

`/plugin-installer` 网关不产生任何模型可见内容。网关不发起模型请求，也不注册任何面向模型的内容；它经 HTTPS 从配置的 registry 下载包，或 spawn `git`。

#### Token 影响

当前进程内为零。

#### KV Cache 影响

当前进程内无影响；本网关不会给任何提供方请求带来变化。

## 已知限制与延期工作

- npm tarball 尚未做完整性固定；HTTPS 是唯一的传输保证。
- git 来源需要本机存在 `git` 二进制（Windows 安装可能缺失）。
- 已安装插件在重启后以完整宿主权限运行——安装任意包是用户拥有的代码执行决策。
