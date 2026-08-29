# Agent Note：DSHCode fork 同步上游 dsh-v0.1.1-rc.2

Status: implemented

[English](2026-08-21-dshcode-sync-upstream-011-rc2.md) | 中文

## 问题

fork 的 master 在 dsh 0.1.0-rc.8 基线之上承载 DSHCode 桌面产品，而上游前进 207 个提交到达 dsh-v0.1.1-rc.2。两侧增量在共享面上相撞：上游用 IndexInjection 启动 seams 取代 tapIndex 注入管线、统一图片请求管线、更名插件设置页监听的凭据事件、拆分 CI workflow——每一项都与 fork 侧桌面产品代码冲突。持续落后会让未来每次同步都更贵。

## 决策

master 以单个合并集成上游 `b150a551b8`；已发布的桌面标签保持不动。合并固化以下现行决议：

- Web 启动链采纳上游的 IndexInjection seams（`bootInjections`，manifest 经 `globalThis["__DSH_BOOT__"]` 渲染）。桌面壳保留三个接入点——ui-renderer 标题栏包裹、web-app 补丁层产品行、Electron 壳——不注入自定义 transport。
- 统一图片管线取代 fork 的 `selectModel` 图片准入检查：纯文本或 note 策略目标始终可选，因为 `projectImagesForTextModel` 会把图片投影为文本备注。fork 保留其 describe-image 设置卡与 `packages/vision/tool-describe-image`；它们与 canonical 编码及 `read_image` 缩放语义的对齐是延后的跟进工作。
- 凭据保留启动时的扁平文档迁移；插件设置页的 describe-image 与 web-search 两张卡都改听更名的 `credentials/reference-updated` 事件。
- 所有 package.json 保留 fork 的 1.0.x 桌面版本行，依赖与脚本字段取上游；`.github/workflows/issue-lifecycle.yml` 维持删除，fork lane（`fork-ci.yml`、`desktop.yml`）与上游拆分出的 workflow 并存。

## 备选方案

**以 rebase 取代 merge 把 fork 提交接到上游上。** 线性历史更整洁，但桌面线已发布：`desktop-v1.0.x` 标签及建立其上的回放通道将指向被重写的提交。合并保持已发布历史不可变。

**推迟同步直到上游首个稳定标签。** 节奏噪音更小，但每个跳过的 rc 都会放大冲突面，且 rc.2 已经改变了桌面产品共享的模型可见图片行为。

**现在就删掉 describe-image 卡而非延后对齐。** 跟随上游删除会在一个同步提交里砍掉已发布的桌面功能；保留它维持产品行为，并把剩余差异收敛到一个有跟踪的跟进项。

## 后果

会话与存储格式不变（`SESSION_FORMAT_VERSION` 仍为 0），存量用户数据除凭据文档外无需迁移——凭据文档在启动时于写锁下自行升级。未来同步从本次合并起步，fork 对上游的差量重新收敛为一个 integrate 提交加桌面产品线。打标签 desktop-v1.0.7 要求全量门禁绿（build、typecheck、test、snapshot、doc-sync、hygiene），外加桌面回归——在真实用户数据副本上做凭据迁移冒烟、已装插件加载检查、打包产物冒烟。describe-image 对齐跟进项负责收窄 fork 视觉工具与上游 canonical 图片编码间的剩余差异。
