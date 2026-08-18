# Agent Note: Win32 对话框 worker 源码启动去掉 tsx 引导

Status: implemented

[English](2026-08-19-win32-dialog-worker-source-launch.md) | 中文

## 问题

在 Windows 上，源码层面的文件夹对话框 worker 从未成功启动：Web UI 报
`win32 folder dialog worker exited before reporting a result`。根因在启动方式而非
koffi：`spawnDialogWorker` 的源码分支以 `node --import tsx/esm <绝对路径 .ts>`
运行。通过 `--import` 注册 loader 后，Node 的 ESM loader 会把入口当作 URL
解析，Windows 绝对路径（`E:\...`）变成 `e:` 协议 URL，在 worker 发出第一条
IPC 消息之前就抛出 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。驱动端于是只上报笼统的
退出错误。打包用户不受影响，因为他们以纯 node 启动构建产物 `worker.cjs`；
该 bug 命中 Windows 上每一次源码启动（`pnpm dsh web`）。

CI 漏掉它还有第二个叠加原因：built/源码分支选择用的是
`import.meta.url.endsWith('.ts')`，而在 Vitest/Vite 下 URL 带查询串（`?v=...`），
win32 冒烟测试静默地走了 built 分支——从未覆盖坏掉的源码启动。

## 决策

源码 worker 以纯 node + 原生类型剥离运行，不再经过 tsx 引导：

```ts
spawn(process.execPath, [fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], ...)
```

这是安全的，因为 worker 的依赖链（worker、bindings、logic）只用可擦除的
TypeScript 语法——没有参数属性、装饰器或值命名空间——不像保留 tsx ESM
hook 的 CLI 源码图。原生类型剥离自 Node 22.18 起稳定，落在 engines 范围
（`^22.19.0 || >=24.0.0`）内。built 分支（纯 node 跑 `worker.cjs`）不变。

分支选择改为 `new URL(import.meta.url).pathname.endsWith('.ts')`，bundler
查询串无法再把源码模块误判为 built 产物。这让 win32 冒烟测试真正覆盖源码
启动；新增的 `win32-dialog-host.spec.ts` 用例固定源码分支以位置参数传入
worker 路径且不带 `--import`。

## 考虑过的备选方案

**把 worker 作为 `file://` URL 而非路径传入。**拒绝：tsx 的 tsconfig-paths
钩子会把 `file://` URL 破坏成 `<cwd>\file:\<path>`
（`ERR_MODULE_NOT_FOUND`）；只要还沾 tsx，启动就是脆弱的。

**探测 koffi 可用性并回退到纯 Node 对话框。**超出范围：dshcode 固定
koffi 3.1.1，早于损坏的 3.1.3/3.1.4 win32-x64 预编译，worker 的 koffi 用法
在本代码库并非故障点；worker 在 koffi 加载之前就已崩溃。

## 影响

- Windows 源码启动（`pnpm dsh web`）重新能弹出文件夹对话框；`e:` 协议
  URL 这一失败模式随 loader 链一起消失。
- 打包宿主与 POSIX 无功能变化：它们本来就在纯 node 下运行 worker。
- win32 冒烟测试现在端到端覆盖源码分支；回归到 loader 引导启动会同时被
  spawn 参数固定与真实对话框冒烟测试抓住。

## 验证

`packages/host/directory-picker-native/tests/win32-dialog.spec.ts` 通过源码
启动真实打开并中止关闭对话框。新增的 `win32-dialog-host.spec.ts` 用例断言
位置参数的 worker 路径且不带 `--import`。包内完整测试套件：48 通过，
1 跳过（win32 跳过的 built-worker e2e）。
