# Agent Note: Win32 对话框 worker 源码启动去掉 tsx 引导

Status: implemented

[English](2026-08-19-win32-dialog-worker-source-launch.md) | 中文

## 问题

Windows 上源码层面的文件夹对话框 worker 从未启动成功：Web UI 只报出 `win32 folder dialog worker exited before reporting a result`。故障出在启动向量而非 koffi：源码分支使用 `node --import tsx/esm <绝对路径 .ts>`。通过 `--import` 注册 loader 后，Windows 绝对路径可能被当作 `e:` scheme URL 解析并以 `ERR_UNSUPPORTED_ESM_URL_SCHEME` 拒绝，此时 worker 还没发出第一条 IPC 消息。

分支判断此前读的是裸 `import.meta.url`。Vitest 与 Vite 可能给模块 URL 附加查询串，而带查询串的 URL 通不过当时的 `endsWith('.ts')` 判断，于是源码层面的测试会选中 built 分支。这属于 bundler 测试环境的风险，不是 Windows 故障在 POSIX 运行时的成因。

## 决策

源码 worker 直接由 Node 原生类型剥离运行：

```ts
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

spawn(process.execPath, [fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], {
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
})
```

仓库 engines 要求 `^22.19.0 || >=24.0.0`，且该 worker 的依赖图是包内闭合的：worker、bindings、logic 三个模块都不导入 workspace 包，因此不需要 tsconfig `paths` 投射。依赖图只使用可擦除语法，且**相对导入全部为仅类型导入**；`tsconfig.base.json` 设置了 `verbatimModuleSyntax: false`，TypeScript 不会把值位置的类型导入强制改写为仅类型导入，而这种导入在直接原生剥离下会失败。

`packages/code-runtime/code-runtime-worker-thread/src/index.ts` 已经在同样这两个前提下以这种方式加载它的源码 worker，`docs/testing.md#test-subprocess-launch-modes` 也允许可擦除的 `.ts` 子进程直接由 Node 运行，不经 tsx 或根路径映射。

打包分支继续由纯 node 启动 `worker.cjs`。两个分支都由 `new URL(import.meta.url).pathname.endsWith('.ts')` 选择，模块 URL 上的查询串无法把源码模块误判为构建产物。

## 运行时环境继承

源码 worker 会继承宿主的 `NODE_OPTIONS`，支持的 Node 范围内两种关闭原生类型剥离的写法都会从子进程环境中移除：

- `--no-experimental-strip-types`
- `--no-strip-types`

其余 `NODE_OPTIONS` 条目全部保留；若整串只有这些禁用 flag，子进程中该变量为未设置。清理只作用于源码分支：打包后的 `worker.cjs` 分支没有原生类型剥离依赖，其继承的选项原样透传。

这两个前提由真实 worker 启动而非静态门禁保证。加入 value `enum` 这类不可擦除语法，或把仅类型导入退化为值导入，Node 会在 worker 上报之前拒绝入口，表现为 worker 退出类拒绝，而不是预期中的 Win32 对话框错误。

## 相关启动路径

`dsh` CLI 的源码启动保留 tsx ESM hook，因为它的源码图需要 Node 已不再提供的 transform 模式，见[源码启动决策](../architecture/2026-07-29-dsh-source-launch-tsx-esm.md)；那条约束针对的是 CLI 源码图，而不是说 engines 范围内没有原生剥离。

`packages/workflow/workflow-worker-thread/src/host.ts` 同样从裸 `import.meta.url` 选择源码/构建分支，但它的 worker 从携带正确 `file://` href 的 `data:` URL 启动，Windows `e:` scheme 故障触及不到那条启动路径。

## Alternatives considered

**把 worker 作为 `file://` URL 而不是路径传入。** 拒绝：tsx 的 tsconfig-paths hook 会把 `file://` URL 改写成 `<cwd>\file:\<path>`（`ERR_MODULE_NOT_FOUND`）；只要还牵扯 tsx，启动就是脆弱的。

**探测 koffi 可用性并回退到纯 Node 对话框。** 超出范围：dshcode 固定 koffi 3.1.1，早于损坏的 3.1.3/3.1.4 win32-x64 预编译，因此 worker 对 koffi 的用法并非本代码库的故障点；worker 在 koffi 加载之前就已崩溃。

**给子进程显式传入开启 flag，而不是清理 `NODE_OPTIONS`。** 拒绝：Node 已经把该特性的否定写法改过一次（先是 `--no-experimental-strip-types`，后为 `--no-strip-types`），硬编码开启 flag 会把启动绑定到某条 Node 线；移除两种已知的禁用写法不需要这种绑定，也不动宿主的任何无关选项。

## Consequences

- Windows 源码启动（`pnpm dsh web`）直接由 Node 原生类型剥离运行 worker，loader 链带来的 `e:` scheme 故障消失。
- 打包宿主保持不变的 CJS worker 分支，`NODE_OPTIONS` 不被改写。
- 源码分支依赖 engines 范围、包内闭合且只含可擦除语法的依赖图、仅类型的相对导入，以及移除继承的类型剥离禁用 flag；`packages/host/directory-picker-native/README.md` 为使用者记录了这些前提。
- 即使模块运行器给 URL 附加查询串，Win32 冒烟测试也能进入真实的源码启动。

## 验证

- `packages/host/directory-picker-native/tests/win32-dialog-host.spec.ts` 钉住源码启动：由 `process.execPath` 以唯一位置参数运行 worker 路径，不带任何 loader flag。
- 同一套件钉住 `NODE_OPTIONS` 的三种输入：混合串保留无关条目、只含禁用 flag 的串使该变量为未设置、未设置时保持未设置且父进程不被修改。
- `tests/win32-dialog.spec.ts` 在 POSIX 上启动真实源码 worker，这正是能抓住依赖图中不可擦除语法或丢失仅类型导入的地方。
- 在 win32 上，同一套件通过源码分支真实打开并中止关闭对话框；`tests/built-worker.e2e.ts` 负责本决策未改动的打包 `worker.cjs` 分支。
