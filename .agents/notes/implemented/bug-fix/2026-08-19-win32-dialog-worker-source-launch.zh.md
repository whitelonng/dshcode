# Agent Note: Win32 对话框 worker 源码启动去掉 tsx 引导

Status: implemented

[English](2026-08-19-win32-dialog-worker-source-launch.md) | 中文

## 问题

Windows 上源码面的文件夹对话框 worker 从未启动成功：Web UI 只报出 `win32 folder dialog worker exited before reporting a result`。故障出在启动向量而非 koffi：源码分支运行的是 `node --import tsx/esm <绝对路径 .ts>`。通过 `--import` 注册 loader 后，像 `E:\dsh\packages\host\directory-picker-native\src\win32-dialog-worker.ts` 这样的绝对路径可能被读作 `e:` scheme URL 并以 `ERR_UNSUPPORTED_ESM_URL_SCHEME` 拒绝，此时 worker 还没发出第一条 IPC 消息。与仓库中其他「绝对路径」启动的区别在于注册的入口：它们注册的是完整的 `tsx` 入口（`packages/test-support/loader-smoke/src/index.ts`），在 Windows CI 上是绿的，而这个分支注册的是仅 ESM 的 `tsx/esm` hook。

决定启动哪个分支的判断此前读的是裸 `import.meta.url`。Vitest 与 Vite 可能给模块 URL 附加查询串，带查询串的 URL 通不过这个后缀判断，于是源码面的测试可能跑到 built 分支上——这属于 bundler 测试环境的风险，而不是 Windows 故障的成因。

## 决策

源码 worker 直接由 Node 原生类型剥离运行：

```ts
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

declare const env: NodeJS.ProcessEnv
spawn(process.execPath, [fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], { env, windowsHide: true })
```

仓库 engines 要求 `^22.19.0 || >=24.0.0`，且该 worker 的依赖图是包内闭合的：worker、bindings、logic 三个模块都不导入 workspace 包，因此不需要 tsconfig `paths` 投射。

凡是命名类型的相对导入都必须标注，用 `import type` 或行内 `type` 修饰符。`tsconfig.base.json` 设置了 `verbatimModuleSyntax: false`，未标注的类型导入会在构建时被消除，`typecheck` 与打包都不会报错，而 Node 剥离模式会保留该导入并在加载时以 `does not provide an export named` 失败。因此即使没有任何编译器或 lint 规则强制，这里也必须标注。

`packages/code-runtime/code-runtime-worker-thread/src/index.ts` 已经在同样这两个前提下以这种方式加载它的源码 worker，[测试子进程启动方式](../../../../docs/testing.md#test-subprocess-launch-modes)也允许可擦除的 `.ts` 子进程直接由 Node 运行，不经 tsx 或根路径映射。

打包分支继续由纯 node 启动 `worker.cjs`。两个分支都由 `new URL(import.meta.url).pathname.endsWith('.ts')` 选择，模块 URL 上的查询串无法把源码模块误判为构建产物。

这两个前提都没有静态门禁，由真实 worker 启动来保证。出现剥离模式拒绝的语法——value `enum`、带运行时成员的 `namespace`、参数属性、装饰器——或有类型导入漏了标注，Node 会在 worker 上报之前拒绝入口，表现为 worker 退出类拒绝，而不是预期中的 Win32 对话框错误。

## 继承的 NODE_OPTIONS

源码 worker 会继承宿主的 `NODE_OPTIONS`，支持的 Node 范围内两种关闭原生类型剥离的写法都会从子进程环境中移除：

- `--no-experimental-strip-types`
- `--no-strip-types`

其余条目全部保留；若整串只有这些禁用 flag，子进程中该变量为未设置。清理只作用于源码分支：打包后的 `worker.cjs` 分支没有原生类型剥离依赖，其继承的选项原样透传。

继承而来的 `--import` 同样会被保留，因此在进程级注册 loader 的宿主会把 `e:` scheme 风险重新放回 worker 路径之前。本启动无法区分插桩 hook 与 TypeScript hook，这种情况仍需宿主自行规避。

## 相关启动路径

`dsh` CLI 的源码启动保留 tsx ESM hook，因为它的源码图需要 Node 已不再提供的 transform 模式，见[源码启动决策](../architecture/2026-07-29-dsh-source-launch-tsx-esm.md)；那条约束针对的是 CLI 源码图，而不是说 engines 范围内没有原生剥离。

`packages/sandbox/sandbox-local/src/index.ts` 仍在为 windows-acl runner 的源码分支拼出同一个启动向量——同样是仅 ESM 的 `tsx/esm` hook 加绝对路径，而那个源码图同样包内闭合且可擦除，因此同样的启动方式适用。它属于独立改动：一并要改写 `packages/sandbox/sandbox-local/tests/local.spec.ts` 中钉住 `--import tsx/esm` 前缀的断言。

`packages/workflow/workflow-worker-thread/src/host.ts` 同样从裸 `import.meta.url` 选择源码/构建分支，但它的 worker 从携带正确 `file://` href 的 `data:` URL 启动，`e:` scheme 故障触及不到那条启动路径。它的裸判断确实留下了查询串风险：在已构建的树上，带查询串的 URL 会选中 `worker.cjs`，于是那里的源码面测试可能跑到构建产物上——这影响测试覆盖的是哪个产物，而非生产启动。

## 考虑过的替代方案

**把 worker 作为 `file://` URL 而不是路径传入。** 拒绝：tsx 的 tsconfig-paths hook 会把 `file://` URL 改写成 `<cwd>\file:\<path>`（`ERR_MODULE_NOT_FOUND`）；只要还牵扯 tsx，启动就是脆弱的。

**探测 koffi 可用性并回退到纯 Node 对话框。** 超出范围：锁文件把 koffi 解析到 3.1.1，而 worker 在 koffi 加载之前就已崩溃，因此 koffi 并非本代码库的故障点。

**给子进程显式传入开启 flag，而不是清理 `NODE_OPTIONS`。** 拒绝：Node 已经把该特性的否定写法改过一次（先是 `--no-experimental-strip-types`，后为 `--no-strip-types`），硬编码开启 flag 会把启动绑定到某条 Node 线，而移除两种已知的禁用写法在整个 engines 范围内都成立。

## 后果

- Windows 源码启动（`pnpm dsh web`）直接由 Node 原生类型剥离运行 worker，不再有任何 loader 链会把 worker 路径读成 `e:` scheme URL。
- 打包宿主保持不变的 CJS worker 分支，`NODE_OPTIONS` 不被改写。
- 源码分支依赖 engines 范围、包内闭合且只含可擦除语法的依赖图、标注过的类型导入，以及移除继承的类型剥离禁用 flag；[包 README](../../../../packages/host/directory-picker-native/README.md) 为使用者写明了这些前提。
- 即使模块运行器给 URL 附加查询串，Win32 冒烟测试也能进入真实的源码启动。

## 验证

- `packages/host/directory-picker-native/tests/win32-dialog-host.spec.ts` 钉住源码启动：由 `process.execPath` 以唯一位置参数运行 worker 路径，不带任何 loader flag。
- 同一套件覆盖 `NODE_OPTIONS` 的三种场景——混合串保留无关条目且不改动父进程、只含禁用 flag 的串使该变量为未设置、未设置时保持未设置。
- `tests/win32-dialog.spec.ts` 在 POSIX 上启动真实源码 worker。出现不可擦除语法或未标注的类型导入时，该启动会在上报前退出，于是测试以 worker 退出类拒绝失败，而不是预期的 `win32 folder dialog failed`。
- 在 win32 上，同一套件通过源码分支真实打开并中止关闭对话框；`tests/built-worker.e2e.ts` 负责本决策未改动的打包 `worker.cjs` 分支。
