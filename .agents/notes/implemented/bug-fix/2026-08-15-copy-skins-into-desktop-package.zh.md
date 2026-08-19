# Agent Note: 将皮肤包拷贝进桌面打包暂存目录

Status: implemented

[English](2026-08-15-copy-skins-into-desktop-package.md) | 中文

## Problem

`prepare-package` 的 `assembleSkinsExtras` 把每个暂存的皮肤包从 `$TMPDIR/dshcode-desktop-<id>/node_modules/.pnpm/...` 软链到 `skins-extras`，electron-builder 再把这棵树作为 `node_modules/skins` 打进应用包。于是打包后的应用依赖临时暂存目录存活：系统随时可能清理 `$TMPDIR`，且每次重新打包都会重写暂存区，所以打进包里的链接在清理后或暂存包集合变化时就会悬空。一个由 `dsh-skin` 管理的 profile 链接指向了后来重新打包不再产出的 `skins/blue-fantasy` 条目，导致该行在启动时失败。

## Decision

`assembleSkinsExtras` 把每个皮肤包目录拷贝进 `skins-extras`，不再软链。应用包因此自包含：随包发布的皮肤不再依赖临时目录存活，也不再依赖暂存布局。暂存目录在每次打包开始时都会删除重建，因此拷贝目标整体替换而非逐一比对。

## Alternatives considered

**把整个暂存的 `.pnpm` store 一起打包。** 否决：为了几个小包成倍增大安装包体积，还把开发期的布局细节带进发布产物。

**保留软链，改为应用首次启动时在包内重建。** 否决：这会让启动修改已安装的应用，而且导致链接失效的同一类包集合漂移同样会让重建失败或指向错误版本。

## Consequences

重新打包的桌面构建携带真实的皮肤目录。部署闭包不再包含的皮肤包仍然不在包里——引用它们的行照旧在启动时响亮失败——但每个随包发布的皮肤现在都不依赖临时目录。该打包变更由下一次桌面打包运行验证；皮肤中心的解析契约（祖先 `node_modules` 旁的 `skins/` 目录）不变。

## Related

[内置社区插件与按 profile 的控制](../../implemented/architecture/2026-08-14-built-in-community-plugins-and-controls.md) 拥有由部署维护的皮肤树与被打补丁的皮肤中心解析方式，本打包步骤组装的就是它。
