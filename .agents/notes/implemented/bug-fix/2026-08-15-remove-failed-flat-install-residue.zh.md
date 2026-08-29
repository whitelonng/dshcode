# Agent Note: 清除扁平回退目录中安装失败的残留

Status: implemented

[English](2026-08-15-remove-failed-flat-install-residue.md) | 中文

## Problem

`installNpmPackage` 在下载 tarball 之前先删除并重建目标目录，然后解包进去。此后的任何失败——下载中止、tar 出错、完整性校验不符——都会在扁平模块回退目录里留下一个空目录或半解包的目录。Node 的解析器对「存在但没有 manifest 的目录」报 `Cannot find package X` 并停止向上查找，因此残留既破坏了所有导入该包的启动，又掩盖了安装从未完成的事实。一次被取消的 `dsh-web-ui-all` 依赖遍历留下了空的 `ssh2` 与 `cloudflared` 目录，使 `dsh-ssh` 与 `dsh-remote-web-ui` 两行在启动时以完全相同的形态失败。

## Decision

`installNpmPackage` 把解包与完整性校验包进一层处理：任何失败都先删除目标目录再重新抛出。安装失败后回退目录与从未尝试时一样：父目录解析不再被阻断，下一次安装或启动看到的是「不存在」，而不是一个坏掉的包。

## Alternatives considered

**解包到暂存目录再原子改名。** 否决：比这个失败形态所需的机制更重——每次安装开始时目标目录本来就会被删除，失败时并没有旧的好副本需要保留；删掉残缺状态就是全部修复。

**保留残留，改为让解析跳过空目录。** 否决：这等于在每个消费者处粉饰安装器失败，而且「目录可见却报 Cannot find package」的困惑依旧存在。

## Consequences

失败或被取消的依赖安装不再能破坏后续启动。回归测试以一个完整性校验不符的安装断言其目标目录事后不存在。已经踩到该问题的机器上的残留目录（`~/.dsh/profiles/node_modules` 下空的 `ssh2` 或 `cloudflared`）可手动删除，或由下一次成功的安装以真实内容替换。

## Related

[用户插件安装与更新管线](../../implemented/architecture/2026-08-14-user-plugin-install-and-update.zh.md) 拥有扁平模块回退目录与 bundle 依赖遍历；本记录修复其失败残留。
