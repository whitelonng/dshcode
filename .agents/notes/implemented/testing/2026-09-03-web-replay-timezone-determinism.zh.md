# Agent Note：Web 回放固定录制时区

Status: implemented

[English](2026-09-03-web-replay-timezone-determinism.md) | 中文

## 问题

签入仓库的 web golden 持久化了客户端的 IANA 时区：每条用户消息的 source 元数据都记录 `clientTimeZone`，场景 fixture 原样回放这份数据。上游在自己的 runner 池上录制并回放这些 golden，其宿主机运行在 Asia/Shanghai，因此签入的 fixture 全部是 `clientTimeZone: "Asia/Shanghai"`。本 fork 在 UTC 时区的 GitHub 托管 runner 上回放同一套用例，新驱动的会话渲染出 `clientTimeZone: "UTC"`，所有携带会话的场景回放上海时区录制的 golden 全部失败。反复刷新 golden 无法修复：每个宿主录制各自的时区，从一台宿主签入的 golden 在其他所有宿主上都会失败，回放结果取决于录制它的那台机器。

## 决策

共享页面助手 `newEnglishPage` 在客户端启动前把 Playwright 页面与其语言、viewport 一起固定到 `Asia/Shanghai`，因此无论宿主为何，每次录制与回放的会话都携带已签入 golden 的时区。refresh 仍是 golden 的唯一写入者，且 refresh 通过同一助手驱动页面，录制与回放在任何宿主上产生的 `clientTimeZone` 值一致。刻意变化时区的场景（如 schedule-after）自行设置显式 `timezoneId`，不受影响。

## 曾考虑的替代方案

**把 `clientTimeZone` 从 golden 中投影掉。** 否决：时区是产品为每条用户消息记录的真实持久化 source 元数据；投影掉它是掩盖而非消除真实的宿主变量，并会让本 fork 的 fixture 格式偏离上游。

**在 CI runner 上刷新 golden 并推回分支。** 否决：fork CI 受自身只读契约测试约束不持有写权限；PR 检出是 detached HEAD 上的合成 merge，该推送永远被非快进拒绝；且按宿主录制的 golden 仍让回放依赖宿主——每台宿主的录制在其他宿主上依然是错的。

**让 fork 的 CI 跑在上海时区的自托管 runner 上。** 否决：为 fork 承担托管与运维成本，且本地开发机仍会录制各自的时区。

**为测试进程设置 `TZ` 环境变量。** 否决：修复浏览器页面时区的受支持方式是 Playwright 的 `timezoneId`；环境变量无法在不同浏览器构建间确定性地控制页面渲染使用的 Intl 时区。

## 后果

回放对时区稳定：开发机、UTC 托管 runner 与录制宿主行为一致，golden 与上游一样记录 `clientTimeZone: "Asia/Shanghai"`。固定值与已签入的 golden 必须一致：用不同时区录制会重新引入宿主依赖，pin 缺失时任何 UTC 宿主在下次回放该 lane 时都会重新出现 `clientTimeZone` diff。
