# Agent Note: Win32 对话框 worker 源码启动去掉 tsx 引导

Status: implemented

[English](2026-08-19-win32-dialog-worker-source-launch.md) | 中文

## 问题

Windows 上源码层面的文件夹对话框 worker 无法启动：Web UI 只能看到
`win32 folder dialog worker exited before reporting a result`。问题出在启动向量而非
koffi：源码分支之前使用 `node --import tsx/esm <绝对路径 .ts>`。注册 `--import`
loader 后，Windows 绝对路径可能被按 `e:` scheme URL 处理，在 worker 发出第一条 IPC
消息前就因 `ERR_UNSUPPORTED_ESM_URL_SCHEME` 退出。

CI 还存在第二个测试选择盲区：Vitest/Vite 可能给 `import.meta.url` 添加查询串，因此
直接使用 `import.meta.url.endsWith('.ts')` 的判断可能在源码测试中错误选择 built 分支。
这里把它限定为 bundler 测试环境的风险，而不是 POSIX 运行时根因。

## 决策

源码 worker 直接由 Node 原生 TypeScript 类型剥离运行：

```ts
spawn(process.execPath, [fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], ...)
```

仓库 engines 为 `^22.19.0 || >=24.0.0`；该 worker 的依赖图是包内闭合的，worker、
bindings、logic 都不导入 workspace 包。依赖图只使用可擦除 TypeScript，且使用
**仅类型的相对导入**；`tsconfig.base.json` 设置了 `verbatimModuleSyntax: false`，
因此 value-position 的类型导入不会自动变成 type-only import，直接原生类型剥离时并不安全。

这不是新的运行模式，仓库已有先例：`packages/code-runtime/code-runtime-worker-thread/src/index.ts`
已经让源码 worker 直接由 Node 原生类型剥离加载，并明确要求“仅可擦除语法 + 仅类型相对导入”；
`docs/testing.md#test-subprocess-launch-modes` 也明确允许可擦除 `.ts` 子进程直接由 Node
运行，而不使用 tsx 或根路径映射。

打包分支继续由纯 node 启动 `worker.cjs`。源码/构建分支判断改用
`new URL(import.meta.url).pathname.endsWith('.ts')`，避免 bundler 查询串误判源码模块。

## 运行时环境继承

源码 worker 会继承宿主的 `NODE_OPTIONS`。为避免宿主设置重新关闭 Node 原生类型剥离，同时
兼容支持范围内的两种写法，子进程会移除：

- `--no-experimental-strip-types`
- `--no-strip-types`

其他 `NODE_OPTIONS` 参数保持不变。这个清理只作用于源码分支，因为打包后的 `worker.cjs`
没有原生 TypeScript 类型剥离依赖，不应为无关原因改写其继承环境。

源码依赖图的可擦除性也有真实启动保护：如果加入 value `enum` 等不可擦除语法，或者丢失
类型导入约束，原生 Node worker 会在 POSIX CI 上先于预期的 Win32 对话框错误失败，因此会
捕获这类源码图漂移。

## 相关启动路径

CLI 源码图仍然保留 tsx，因为它的运行时依赖图更大，这是有意的独立场景。打包后的 dialog
worker 已经是 CJS，也不需要这套源码处理。

`packages/workflow/workflow-worker-thread/src/host.ts:69` 同样存在源码/构建分支判断，但它的
worker 从带有正确 `file://` href 的 `data:` URL 启动，因此不存在本次 Windows `e:` scheme
失败。该文件无需修改；这里保留说明是为了明确同类 arm-detection 的对称性，以及为什么
本 PR 不扩展到该包。

## Alternatives considered

**使用 `file://` URL 传入 worker，而不是路径。** 拒绝：tsx 的 tsconfig-paths hook 会把
`file://` URL 改写成 `<cwd>\\file:\\<path>`（`ERR_MODULE_NOT_FOUND`）；只要继续引入 tsx，
启动方式仍然脆弱。

**探测 koffi 可用性并回退到纯 Node 对话框。** 超出范围：dshcode 固定 koffi 3.1.1，早于
出现问题的 3.1.3/3.1.4 win32-x64 预编译，因此 koffi 并不是本代码库中的失败点；worker
在加载 koffi 之前就已经退出。

## Consequences

- Windows 源码启动（`pnpm dsh web`）直接运行 native type stripping worker，消除原先
  loader 链导致的 `e:` scheme 失败。
- 打包宿主继续使用不变的 CJS worker，并且不会修改其 `NODE_OPTIONS`。
- 源码分支现在明确依赖仓库 Node engines、包内闭合的可擦除依赖图、仅类型相对导入，以及
  清理继承的类型剥离禁用 flag。
- 即使 Vitest/Vite 给模块 URL 添加查询串，Win32 源码冒烟测试仍会进入真实 source arm。

## 验证

- directory-picker-native Vitest：**51 passed, 1 skipped**。
- coverage：新增 sanitizer `undefined` 分支测试，保持每文件 100% branch threshold。
- typecheck：通过。
- lint：0 warnings，0 errors。
- `verify-translation-pairing`：通过，中英文 Agent Note sidecar 一致。
- `verify-agent-note-classification`：通过。
- `verify-agent-note-format`：恢复必需的 `Alternatives considered` 与 `Consequences`。
- 现有 Win32 smoke test 继续覆盖真实源码 worker 的对话框启动。
