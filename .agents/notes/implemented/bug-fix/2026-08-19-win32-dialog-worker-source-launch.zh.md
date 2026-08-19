# Agent Note: Win32 对话框 worker 源码启动去掉 tsx 引导

Status: implemented

[English](2026-08-19-win32-dialog-worker-source-launch.md) | 中文

## 问题

Windows 上源码层面的文件夹对话框 worker 无法启动：Web UI 只能看到
`win32 folder dialog worker exited before reporting a result`。问题出在启动向量而非
koffi：源码分支之前使用 `node --import tsx/esm <绝对路径 .ts>`。注册 `--import`
loader 后，Windows 绝对路径可能被按 `e:` scheme URL 处理，在 worker 发出第一条 IPC
消息前就因 `ERR_UNSUPPORTED_ESM_URL_SCHEME` 退出。

## 决策

源码 worker 直接由 Node 原生 TypeScript 类型剥离运行：

```ts
spawn(process.execPath, [fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], ...)
```

仓库 engines 为 `^22.19.0 || >=24.0.0`；该 worker 的依赖图是包内闭合的，worker、
bindings、logic 都不导入 workspace 包，只使用可擦除的 TypeScript 语法，因此源码
worker 不需要 tsx hook。打包分支继续由纯 node 启动 `worker.cjs`。

源码/构建分支判断改用 `new URL(import.meta.url).pathname.endsWith('.ts')`。这里把
查询串问题明确限定为 bundler 测试环境的风险，而不是 POSIX 运行时的根因：
Vitest/Vite 可能给模块 URL 添加查询串，普通 POSIX Node 执行不会复现这一点。

## 运行时环境继承

源码 worker 会继承宿主的 `NODE_OPTIONS`。为避免宿主设置重新关闭 Node 原生类型
剥离，同时兼容支持范围内的两种写法，子进程会移除：

- `--no-experimental-strip-types`
- `--no-strip-types`

其他 `NODE_OPTIONS` 参数保持不变。这样不会因为宿主环境变量再次把修复后的
Windows 启动打回同一个笼统的 worker 退出错误。

## 相关启动路径

CLI 源码图仍然保留 tsx，因为它的运行时依赖图更大，这是有意的独立场景。打包后的
dialog worker 已经是 CJS，也不需要这套源码处理。directory-picker 内没有其他采用
“Windows 绝对路径 + `--import` loader”这一启动向量的 worker。

## 验证

- spawn 单测固定源码 worker 以位置参数传入，并拒绝 loader 参数。
- spawn 单测验证两种关闭类型剥离的 `NODE_OPTIONS` 写法都会被移除，同时保留无关参数。
- 现有 Win32 smoke test 继续覆盖真实源码 worker 的对话框启动。
