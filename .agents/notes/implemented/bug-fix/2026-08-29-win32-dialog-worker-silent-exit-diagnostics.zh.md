# Agent Note: Win32 对话框 worker 静默退出时上报退出码和截断的 stderr 尾部

Status: implemented

[English](2026-08-29-win32-dialog-worker-silent-exit-diagnostics.md) | 中文

## 问题

一次 Windows DSHCode 运行在打开工作区文件夹选择器时上报 `directory picker failed: directory picker failed: win32 folder dialog worker exited before reporting a result`，对话框说不清原因。驱动器的 exit 处理器丢弃了子进程的退出码，spawn 又把子进程的 stderr 继承进宿主自己的 stderr，而 Windows GUI 子系统进程没有地方写这个 stderr。所有静默退出成因——缺失的 `worker.cjs`、顶层未捕获异常、原生崩溃、重新启动的应用程序丢掉了单实例锁——都坍缩成同一条无法诊断的消息。打包 smoke 撞上的是同一堵墙：它写结果文件，就是因为 Windows 上的 Electron 输出永远到不了 runner 日志。

## 决策

spawn 改为管道接收 worker 的 stderr（`['ignore', 'inherit', 'pipe', 'ipc']`；stdout 仍继承），驱动器保留其最后 4096 字节。worker 未报结果即退出时，以 `win32 folder dialog worker exited before reporting a result (code <n> | signal <s>)` 拒绝，非空时附上捕获的尾部。worker 协议、只结算一次的保护和 WM_CLOSE 中止路径都不变。

## 考虑过的替代方案

- **stderr 保持继承，只补上退出码。** 被否：单凭退出码无法指认启动、模块或原生崩溃成因，而且 GUI 宿主会整体丢弃继承的 stderr。
- **捕获完整 stderr。** 被否：在长生命周期宿主进程里做无界捕获不可取；崩溃成因在输出末尾，截断的尾部已经够用。
- **把捕获的分块同时转发到宿主 stderr。** 被否：GUI 子系统宿主的父通道是空的，转发增加第二处表面却到不了操作者眼前；尾部随拒绝消息走即可。
- **写 worker 日志文件。** 被否：为一条已随拒绝消息传播的诊断引入需要轮转和清理的新生命周期产物。

## 后果

- 静默退出现在报出退出码或信号，以及 worker stderr 的尾部，用户上报的这类失败在下一次尝试时即可自述成因。
- 开发控制台失去 worker stderr 的实时输出：它只在拒绝消息里出现。worker 在成功路径上不打印任何内容，因此损失仅限于失败诊断。
- 拒绝消息文案是不被钉死的产品可见文本；只有包内测试断言它，且仅限于这些测试。

## 验证

- `packages/host/directory-picker-native/tests/win32-dialog.spec.ts` 钉死仅退出码、带 stderr 退出、仅信号退出和 4096 字节尾部上界的拒绝消息。
- `packages/host/directory-picker-native/tests/win32-dialog-host.spec.ts` 钉死 spawn 的 stdio 为 `['ignore', 'inherit', 'pipe', 'ipc']`。

## 相关

- [Win32 对话框 worker 源码启动去掉 tsx 引导](2026-08-19-win32-dialog-worker-source-launch.zh.md) 拥有本笔记所诊断的静默失败背后的启动分支。
- 打包 smoke 的结果文件变通（`apps/desktop/scripts/smoke-packaged-win32-picker.mjs`）记录的是同一处 GUI 子系统不透明性，本决策在驱动器层面解决它。
