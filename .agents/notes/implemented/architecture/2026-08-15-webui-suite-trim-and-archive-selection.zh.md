# Agent Note: 内置 webui 裁剪、安装时产品冲突自动禁用、归档会话搜索与多选

Status: implemented

[English](2026-08-15-webui-suite-trim-and-archive-selection.md) | 中文

## 问题

随桌面版发布的内置 webui 套件（`packages/bundle/web-app` 的预设产品 `web-ui` 及其 9 个 `@linxin666/*` 依赖）的功能与用户自己安装 `dsh-webui` 能拿到的入口重复——左下角出现两排同功能不同 id 的入口，而安装器的去重（跳过 patch 已拥有的 id 对应的 insert 行）无法识别跨 id 的同义重复。冗余功能还随每次应用更新继续发布。归档会话设置页则无法查找或批量处理多个会话。

## 决策

**内置 webui 裁剪（`packages/bundle/web-app`）。** `web-ui` 预设产品只保留 `pet`（`@linxin666/dsh-pet`）与 `ui-skin-center`（`@linxin666/dsh-client-ui-skin-center`，其 `dsh-client-ui-skin-whale-song` 主题依赖保留）；其余 7 个包从预设行与 `package.json` 依赖中移除（含 `@linxin666/dsh-web-ui-all`）。此后套件更新只动皮肤（pet 保持固定版本）——冗余从发布闭包中彻底消失。

**安装时冲突禁用（`plugin-installer`）。** 网关 `Config` 新增 `disableControlsOnInstall: [{ id, matches }]`；安装或更新成功后，若包名包含任一 `matches` 子串（不区分大小写），网关就把所有带 `# dsh-plugin-control: <id>` 标记的 patch 行置为 `disabled: true`（`patch.ts` 新增 `setControlRowsEnabled`，与 `plugin-control` 的 `control-file.ts` 共用标记约定）。web profile 接入 `[{ id: web-ui, matches: ['dsh-web-ui'] }]`——用户自装的 webui 套件会在下次启动时把内置产品关掉，而不是双重挂载。

**归档搜索与多选（`dsh-client-ui-settings-archive`）。** 该 section 新增搜索框（按折叠标题或会话 id 过滤）、每行选择复选框与「对过滤结果」的全选开关，以及批量工具栏：恢复所选立即执行（恢复非破坏性），删除所选沿用不可逆删除的确认弹窗；批量操作按选择顺序逐个执行，完成后统一刷新列表。

## 备选方案

**按渲染文案去重。** 按侧边栏条目显示文本匹配需要跨客户端插件的标签注册表，且仍无法区分有意同名条目。拒绝：把冗余包移出发布闭包才是诚实的修法。

**经 plugin-control 通道禁用。** 宿主 RPC 面只有 handle/intercept（无进程内调用），安装器无法调用 plugin-control 的 `set-enabled`。上面的 patch 层规则保持两个插件解耦，无需新的服务缝。

**批量归档端点。** 宿主侧批量恢复/删除可省往返但会触及持久化 API；逐个单行调用复用单行操作已有的同一套校验路径。

## 结果

- 发布应用只挂载 webui 套件的 pet + skin-center；左下角重复入口从闭包中消失，后续套件更新只动皮肤。
- 用户自装 webui 会自动关掉内置产品；若想两者并存，仍可通过预设开关重新开启内置。
- 归档页支持搜索与批量恢复/删除，删除确认纪律与单行一致。
- `plugin-control` 的 `list()` 把条目全部禁用的产品视为 `disabled`，被禁用的内置产品在合并插件列表中呈现一致。

## 相关

- [pnpm 委托、SRI 完整性与插件发现层](2026-08-15-pnpm-delegation-and-plugin-discovery.zh.md) 拥有本变更用 `disableControlsOnInstall` 扩展的网关配置；[合并插件列表标签页](2026-08-15-merged-plugin-list-tab.zh.md) 拥有冲突规则所禁用的预设产品行。
