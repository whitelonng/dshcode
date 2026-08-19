# Agent Note: Fork CI — 基于托管 runner 的并行无密钥车道

Status: implemented

[English](2026-08-19-fork-ci-parallel-lanes.md) | 中文

## Problem

[Fork CI](../../../../.github/workflows/fork-ci.yml) 原本是一个 120 分钟的 `ubuntu-latest` 单 job（lint、typecheck、单元测试、doc-sync），只由 master push 与手动触发：pull request 拿不到任何单测或静态检查信号，某一步失败会跳过其后所有步骤，且该车道出现过失败——第五次运行在一次仅改文档的提交上单元测试失败。继承的上游工作流面向 DeepSeek 组织专属 runner 池与供应商密钥，在 fork 的 Actions 设置中处于 `disabled_manually`，因此 fork 的真实信号完全由这个文件提供。

## Decision

Fork CI 现在是四个并行、无密钥的 job，汇聚到一个稳定判定，全部跑在 GitHub 托管 runner 上：

- `static`（一次 host 构建喂给 lint 与 host+client typecheck、doc-sync 聚合、共享静态门禁——constraints、package invariants、Cordis config、runtime closure、optional-dependency imports、issue policy——模块图检查与桌面运行时闭包）、`unit`（完整 vitest 清单，含 apps/desktop 与 apps/web 的 spec，固定为两个 fork worker，让时序敏感的终端/子进程套件在 4-vCPU runner 上保有裕量）、`web`（构建产物 + `DSH_SNAPSHOT=replay` 浏览器回放）、`coverage`（`check:ci:coverage`，`packages/*/*/src` 逐文件 100%）。
- `all-checks-passed` 以 `if: always()` 聚合三个阻塞车道，失败依赖永远不可能把必查项跳过成绿色；branch protection 只需勾选 `Fork CI / all checks passed`。
- pull request 触发工作流；`cancel-in-progress` 只豁免 push（`${{ github.event_name != 'push' }}`），因为 master push 既是合并后信号也是缓存生产者，而被取代的 PR 与手动运行可丢弃。
- 缓存由 master 流向所有车道：只有 `unit` 车道在 master push 保存 pnpm store（五个并行写同一 key 会竞争并浪费压缩），只有 `web` 车道保存 Playwright 浏览器缓存；每个车道在每个事件上都恢复这两个缓存族。
- `coverage` 以 `DSH_COVERAGE_MAX_WORKERS=3`（两个插桩 worker 加一个豁免重套件 worker）与 `DSH_GATE_CONCURRENCY=2` 运行，两个 coverage gate 以 2 + 1 = 3 个 fork 重叠而不是串行——按 4-vCPU 托管 runner 定尺寸。本车道的首次 Ubuntu 运行复现了 process-exit 竞态：场景宿主进程因读到写了一半的 tree.json 而崩溃，永远没有发布 ready 文件。宿主夹具现在对读取+解析做重试，场景读取 `DSH_COVERAGE_TEST_TIMEOUT_MS`（本车道设为 60000）放宽 ready 等待，且 ready 超时失败会带出宿主的退出码与 stderr。
- `unit`、`web`、`coverage` 在执行前准备 bubblewrap，与上游车道一致，沙箱套件真正执行而不是静默跳过。
- `static` 车道只在 PR 专属的 `doc-sync` 步骤上把 `DSH_ARCHIVE_BASE_REF` 设为 PR base：空字符串会被脚本当作字面 ref 而非 HEAD 默认值。
- `knip` 与 `duplication` 在 fork 既有债务修复前不进车道：knip 因一个未使用的桌面文件与依赖、108 条未列明的测试导入而失败，jscpd 因 14 处 plugin-installer clone 而失败。`check:ci:static` 内嵌 knip，因此车道以显式步骤运行其绿色子集而非聚合；债务修复后应重新采用 `check:ci:static` 加一个 duplication 步骤。

`web` 车道起初是诊断性的：刻意不进入 `all-checks-passed.needs`，且 job 名带 `(diagnostic)` 后缀，让非阻塞状态在 pull request 检查列表中保持可见。本地无法执行组装应用的受限 bash 工具（宿主沙箱拒绝 `posix_openpt` 与嵌套 `sandbox-exec`，失败沿 aria golden 级联），只有 Ubuntu 上的运行才能证明 fork 的 web golden 是否最新。`web` 保持诊断性，直到 Ubuntu 运行证明 golden 当前为止；将其提升只需改动 `needs` 一行，golden 漂移则先在 CI 上用 `DSH_SNAPSHOT=refresh` 刷新。

上游工作流保持原样（设置里 `disabled_manually`），而不是打 fork 守卫补丁：`scripts/ci-workflow.spec.ts` 用精确字符串钉死了它们的 `if`，设置级禁用让上游同步零冲突。fork 专属的执行门禁 `scripts/fork-ci-workflow.spec.ts` 钉住新契约：触发条件、无密钥、托管 runner、缓存方向、聚合器成员（含诊断性 web 排除），以及快照回放与真实 API e2e 的持续缺席。

## Alternatives considered

**在 ci.yml/e2e.yml 里加文件级仓库守卫**——即使有人重新启用这些工作流，fork 的副本也会干净地跳过。否决：`scripts/ci-workflow.spec.ts` 精确断言这些 `if` 字符串，补丁会分叉共享 spec 文件并在每次上游同步时冲突；工作流本就已在设置中禁用，那才是写者可见的控制点。

**现在就恢复快照回放**——每个 PR 重跑 `test:snapshot`。否决：golden 在 dd602d3668 中因漂移被移除，重新认领需要先在 CI 上验证 fork 侧刷新；这仍是车道回归前的独立一步。

**立即把 `web` 设为阻塞**——否决：未经验证的 golden 造成的红灯会在刷新窗口期内阻塞所有合并；诊断性起步只需在变绿后改一行即可晋升。

## Consequences

pull request 终于携带 fork 的单元、静态与文档、覆盖率信号，各有独立超时与重跑粒度；单体的步骤级联失败模式不复存在。master push 的红灯（第 5 次运行的 unit 失败）仍需定位其失败日志：unit 车道实质未变，该失败是单独的后续事项。coverage 在 4-vCPU runner 上是一条长车道（以 120 分钟为界）。缓存只带来首次延迟：合并后的第一次 master push 会播种两个存储。
