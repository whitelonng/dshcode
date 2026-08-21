# dsh-host-plugin-installer

[English](README.md) | 中文

当前 profile 的仅回环插件安装与更新。网关（`/plugin-installer`）以 `authority: 'loopback'` 注册在 Connection 通道上，暴露：

- `list` —— 从 `$DSH_HOME/plugins.json` 读取已安装快照，每行附带从受管 patch 行读出的已保存启用状态。
- `install { spec }` —— 从 npm spec（`name`、`name@version`、`name@range`）或 git 仓库 URL 安装。npm 包按配置的 registry（默认 `npm_config_registry`，其次 npmjs）解析，下载 tarball 并按 registry 的 `dist.integrity` SRI 声明校验（有声明时；不匹配与不支持的算法集会大声失败，锁定的完整性记入 `plugins.json`），解压到扁平模块 fallback `$DSH_HOME/profiles/node_modules/<name>`；GitHub 仓库（`github:user/repo` 简写或 `https://github.com/user/repo`，可带 `#ref` 后缀固定分支、标签或 commit）从 codeload 下载源码 tarball、经 GitHub API 解析 commit——不需要 `git` 二进制，CDN 下载也不会像克隆那样卡住，设置 `GITHUB_TOKEN`/`GH_TOKEN` 可解除未认证 API 的速率限制（60 次请求/小时）；其他 git 托管做浅克隆（需要 `git` 二进制；`github:user/repo` 简写会规范化为 `https://github.com/user/repo.git`、`git+` 前缀会被剥掉，克隆不依赖本机 git 配置），GitHub URL 在 tarball 路径失败且本机有 git 时回退到同样的浅克隆（codeload 返回 404 即终局——仓库不存在）。克隆后先校验检出身份再写任何内容——根目录没有 `package.json` 的仓库、多包 workspace 根（声明了 `workspaces`；`private: true` 的单包会被接受——git 专发的插件就是这样发布的）或非法包名都会以带 URL 的类型化错误失败。包声明的入口文件（字符串 `exports`、字符串 `exports["."]`、`main`，缺省 `index.js`）必须存在于安装目录——没有提交构建产物的仓库会在安装时就失败并给出「构建并提交」的建议，而不是等到重启时把 Loader 弄崩。只包一个包的 monorepo 壳（根目录没有 `package.json`、其下任意深度只有一个 manifest，跳过 `node_modules`/`.git`）按那个包安装——唯一 manifest 被提升到根目录；多个 manifest 会大声失败并列出它们。粘贴整条 `dsh plugin --profile <name> add <spec>` / `pnpm add <spec>` / `npm install <spec>` 命令会直接提取其中的 spec 安装；其他 shell 命令会被拒绝，并提示只粘贴包名或仓库 URL。安装后把插件记入 `plugins.json`，并向 profile 用户 patch 层（`cordis.patch.yml`）插入受管 `insert` patch 项——用户层把裸行当作对既有条目的补丁，因此安装必须使用 `insert` 项——插件在应用重启后加载。bundle 风格包（声明 `dsh.bundle.patch`）还会把它的传递 npm `dependencies` 装进 fallback（仅当既有副本版本与解析目标不同时才替换，这正是把内置依赖升级到聚合版本的路径），并把 bundle 的 patch 行合并进 profile 用户 patch 层，每行带 `# dsh-plugin-bundle: <id>` 标记：patch 已拥有的 id（预设产品行、插件自己的安装器行）对应的 insert 行会被跳过以免条目被挂载两次，裸覆盖行原样追加，重装或更新会替换该插件先前合并的行。`set-enabled` 会把插件的开关镜像到它合并的 bundle 行上，`uninstall` 会移除这些行。
- `status` —— 浏览器在修改进行中轮询的当前安装/更新进度（`idle`，或 `fetch`/`download`/`extract`/`write` 并带可选的下载百分比）。
- `update { id }` —— 从记录的来源重新安装一个插件并刷新行。
- `uninstall { id }` —— 删除安装目录、受管 patch 行与状态条目。
- `set-enabled { id, enabled }` —— 通过重写受管 patch 行（写入 `disabled` 标记）持久化插件下次启动的启用状态；重启前运行中的 Loader 不受影响。
- `check-updates` —— 把 npm `dist-tags.latest`（git 来源则为远端 HEAD）与已安装版本比较，不做任何变更；离线或已消失的来源按插件跳过。
- `failures` —— 已记录的启动失败（`$DSH_HOME/boot-failures.json`，有界的按插件环形记录：至多 8 条、字段截断、90 天留存、整文件字节上限）、插件安装根目录（`$DSH_HOME/profiles`），以及桌面端是否处于安全模式。桌面主进程通过本包再导出的共享纯函数读写并清扫同一文件（`writeBootFailure`、`clearBootFailures`、`pruneBootFailures`、`readBootFailures`，以及安全模式标记 `setSafeMode`/`readSafeMode` 和恢复流程复用的 patch/state 辅助函数）。
- `set-safe-mode { enabled }` —— 创建或删除安全模式标记文件（`$DSH_HOME/safe-mode`）；桌面端启动时读取它来决定跳过用户 patch 层；与重启动作一起切换。

卸载插件时同时清除它的启动失败记录。

registry 与 GitHub 请求带硬超时，按慢速、被限流的网络来定（npm 元数据 30 秒、npm tarball 60 秒、GitHub API 30 秒、GitHub tarball 300 秒），网络停滞会以错误呈现，而不是让界面停留在永久的“安装中”状态。

所有变更串行化；状态文件在锁内原子写入，patch 层编辑保留每个非属主 YAML 节点、注释与 `!!js` 表达式。

pnpm 可用时，网关把安装/更新/卸载委托给 profile workspace 里的 `pnpm add`/`remove`；探测先查 PATH 上的 `pnpm`，再试静态绝对路径（`/opt/homebrew/bin/pnpm`、`/usr/local/bin/pnpm`、`~/Library/pnpm/pnpm`、`~/.local/share/pnpm/pnpm`、`~/.volta/bin/pnpm`、`~/.local/bin/pnpm`、`~/bin/pnpm`），最后逐个试 nvm 与 fnm 版本目录下的 pnpm——macOS 的 GUI 应用不继承 shell PATH，且 spawn 环境会用这些目录补全 PATH，让 pnpm 的 `env node` shebang 也能解析到 node。可选配置 `githubMirror`（http(s) URL 前缀，如 `https://gh-proxy.com/`，加载时校验）只加在 codeload 与 api.github.com URL 前面，服务受限网络；web profile 把分层 `.env` 里的 `DSH_GITHUB_MIRROR` 传给它。`disableControlsOnInstall` 规则（`[{ id, matches }]`）在安装/更新后的包名命中任一 `matches` 子串时，禁用指定 plugin-control 产品的 patch 行——web profile 用它让用户自装的 webui 套件自动关掉内置 web-ui 产品，避免双重挂载。

## 模型体验

### Agent 工具

#### 模型看到的内容

网关注册四个面向模型的工具（`plugin_search` / `plugin_install` / `plugin_uninstall` / `plugin_status`），与浏览器面板读写同一份安装态：`plugin_search { query?, source?, refresh? }` 把已注册索引源的目录条目（id、形态、来源、能力面、描述、所属源及其信任级别）渲染为每行一条文本；`plugin_install { source }` 返回一行安装结果（安装的 id 与版本，以及重启要求）；`plugin_uninstall { id }` 返回一行移除结果；`plugin_status { id? }` 每个已装插件返回一行（id@版本、安装来源、禁用标记）。它们的名称、描述与 JSON-Schema 参数编入 [tool-catalog.zh.md](../../../docs/tool-catalog.zh.md)，经常规系统提示词工具装配到达模型。

#### Token 影响

四个工具 schema 加入系统提示词输出的工具目录；执行结果是受已装/目录条目数量约束的短文本行。

#### KV Cache 影响

除每个模型请求已携带的共享工具目录装配外无其他影响。

### 回环网关

#### 模型看到的内容

无：`/plugin-installer` RPC 通道仅回环，不发起模型请求，也不注册其他模型可见内容。下载（配置的 npm registry、codeload、GitHub API）与 `pnpm`/`git` 子进程不产生模型可见输出。

#### Token 影响

当前进程为零；安装流量留在宿主内，从不进入模型请求。

#### KV Cache 影响

无；网关不给任何 provider 请求贡献内容。

## 已知限制与延期工作

- packument 未声明 `dist.integrity` 的 tarball 仅以 HTTPS 传输信任，不做内容校验。
- 配置的 `githubMirror` 是第三方服务，能看到（也可能篡改）下载内容——镜像前缀是显式开启的，设置前应知情。
- 非 GitHub 的 git 来源需要本机存在 `git` 二进制（Windows 安装可能缺失；GitHub 仓库经 codeload 下载、无需 git，但 commit 查询受未认证 GitHub API 的 60 次请求/小时速率限制，设置 `GITHUB_TOKEN`/`GH_TOKEN` 可解除）；根目录没有 `package.json` 的仓库（或空仓库）会被拒绝——只有单包 Node 仓库可安装，多包 workspace 根应改装其已发布的 npm 包。
- 依赖树只为 bundle 风格包（`dsh.bundle.patch`）安装；普通插件从应用内置依赖闭包解析自己的依赖。
- 聚合插件卸载后，其 bundle 依赖包仍留在 fallback——它们是未跟踪的支持文件而非已记录插件；后续安装会复用匹配副本或刷新到新的目标版本。
- bundle 中 id 已被 profile patch 拥有的 insert 行会被跳过，既有行（例如预设产品行）保持对该条目的唯一权威。
- 已安装插件在重启后以完整宿主权限运行——安装任意包是用户拥有的代码执行决策。
- 启动失败环形记录覆盖 JS 可捕获的加载失败、启动超时与延迟拒绝；硬崩溃或主线程挂起不会留下记录（这些恢复路径由桌面端的启动标记兜底）。
