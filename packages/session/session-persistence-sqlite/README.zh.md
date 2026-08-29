# @deepseek-ai/dsh-session-persistence-sqlite

[English](README.md) | 中文

一个可选启用的 SQLite `SessionPersistence` 提供方。它将符合条件的 `assistant/chunk` 连续段存入打包后的物理行，对大型 payload 选择性应用 Zstandard 压缩，并对来源序列进行 delta 编码，同时恢复完全一致的逻辑 `SessionEvent[]`。随产品交付的组合均不选择它；部署方需显式挂载本包并提供数据库路径。

`locate(meta)` 返回 `undefined`，因为所有会话共享同一个数据库。该提供方不暴露逐会话原始产物。

## 存储模型

Schema 17 保留普通 ROWID 表以及复合主键索引 `events(session_id, seq)`。标量行存储一个逻辑事件。打包行把 `text-chunks`、`reasoning-chunks` 或 `tool-call-chunks` 用作物理 `type`；`seq` 与 `time` 标识所表示的第一个事件，`data` 保存共享的分片打包 payload。打包行把 `ignorable=0` 用作物理判别值，并让 `source_event_seqs` 与 `surface_op` 保持 `NULL`；标量行仅在逻辑事件可忽略时使用 `ignorable=1`，否则使用 `NULL`。因此，未来的可忽略逻辑事件即使复用了某个存储标签名称，也不会被解码为打包行。这些标签属于存储记录，而不是 `SessionEventMap` 成员。

Schema 17 在本包内拥有 codec，不导入其他持久化格式中可变的实现。只有字段完全匹配、连续且属于同一分片块的文本、推理或工具调用 delta 才会打包。未知字段、surface 元数据、序列缺口、不兼容的块／调用身份以及不安全时间戳仍以标量行存储。一个打包行最多表示 1,024 个事件，未压缩 UTF-8 `data` 最多 1 MiB；更长的连续段会在不改变逻辑事件的前提下分割。读取会在向持久化协调器返回数据前，重建每个原始序列号、时间戳、token 边界、参数片段和 payload。

序列化后的 `data` 小于 4 KiB 时保持为 SQLite `TEXT`。达到或超过该阈值时，写入方会使用 Zstandard level 3，并且只在 frame 小于原文本的情况下存储 `BLOB`；读取方会先解压，再执行 UTF-8 校验和 JSON 解析。`source_event_seqs` 仍是完整且有序的来源数组。第一个序列使用无符号 varint，后续序列使用 ZigZag varint 编码的有符号差值，并存为 `BLOB`；不会省略任何来源，也不会把数组转换成范围。

每次追加持有 `BEGIN IMMEDIATE`，验证有界物理尾部，只打包新的持久批次，插入这些记录，并把会话 revision 递增一次。普通追加绝不删除或替换既有事件行。默认 200 毫秒写后缓冲窗口因此仍能压缩高频流，而物理写入量与新增持久批次成正比，不会反复改写不断增长的打包值。存储层逻辑尾部检查会在陈旧写入方执行变更前拒绝该写入。

完整读取按首个逻辑序列号的顺序扫描物理行。反向扫描会定位最后一个有效 `turn/end`，但不会保留每个物理行的解码副本；正向扫描则逐行解码并校验，写入最终返回的逻辑事件数组。`readFrom(id, fromSeq)` 只检查最大行跨度内的打包前驱，并把后缀锚定在可能包含 `fromSeq` 的最早前驱；这样既可包含从打包行内部开始的事件范围，也能检测相互重叠的物理损坏，而不会解析无关的更早标量行。畸形打包行按全有或全无处理：已提交区域中的损坏会拒绝读取，最终撕裂行则在可变恢复期间从其物理起点删除。修复会在持有写锁时重新读取尾部，并在删除任何数据前拒绝陈旧 marker。打包 `data` 超出 schema 字节上限时，会在解析 JSON 前拒绝。

## Schema 兼容性

全新数据库直接初始化为 schema 17。旧 schema、外部 application identity、非空未版本化数据库以及不兼容 schema 对象都会被拒绝；这个预发布提供方不提供迁移。每条语句和固定 pragma 都位于随包发布的 `.sql` 资源中；值使用 SQLite 参数，运行时代码不会拼装查询文本。

## 配置（schemastery）

```ts
interface Config {
  path: string
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'
  busyTimeoutMs?: number
  preparedSessionCacheSize?: number
  writeBatchMaxDelayMs?: number
}
```

`journalMode` 默认为 `wal`，`busyTimeoutMs` 默认为 `5,000`，`preparedSessionCacheSize` 默认为 `5`，`writeBatchMaxDelayMs` 默认为 `200`。该超时限制每次同步 SQLite 锁等待的时长。SQLite 在切换 journal mode 时可能立即返回 `SQLITE_BUSY`，因此冷打开会在尝试之间让出执行，并在从打开时开始计算的重试截止点后不再发起新尝试。正在执行的同步 SQLite 调用可能在该截止点之后才完成。提供方会在每个连接上禁用可信 schema 与内存映射 I/O，然后读回这两项设置。提供方还会读回所选 journal mode 并要求它匹配；内存数据库显式接受 SQLite 返回的 `memory`。选择 journal 后，提供方会把 `synchronous` 固定为 `FULL` 并验证该设置，避免 SQLite 构建默认值削弱已提交追加的持久性。在 POSIX 上，数据库父目录和文件必须归当前用户所有，父目录不得允许组或其他用户写入，文件不得授予组或其他用户任何权限。符号链接和非普通文件会被拒绝。Windows 同样拒绝符号链接与非普通文件，但部署方仍负责把目录和文件 ACL 限制给 harness 用户。路径与所有权错误会拒绝插件初始化。Node SQLite 在第一次持久化操作时才加载；导入时只抑制 Node 22 精确的 SQLite `ExperimentalWarning`。存储身份与 schema 错误会在暴露或变更数据前拒绝该操作。

## 模型体验

### 恢复的对话历史

#### 模型看到什么

没有 SQLite 特有内容。恢复得到与 JSONL 相同的逻辑事件和派生消息；物理打包标签绝不会进入 prompt、工具、回放或实时 `session/event` 投递。

#### Token 影响

实时请求增加零 token。恢复只为保留的逻辑历史和当前请求 envelope 付出 token。

#### KV Cache 影响

物理打包不会改变请求前缀。与其他持久化后端相同，提供方 cache 复用取决于重建历史、当前 envelope 和模型路由。

## 已知限制与延期工作

- **过渡性的 SQLite 专用设计**——这一以效率为重点的实现参考了 [morlay/session-persistence-rdb](https://github.com/morlay/session-persistence-rdb)。支持多种后端与可配置 schema 的统一关系数据库设计尚待后续完善；预发布开发阶段不保证 schema 稳定性或迁移支持。
- **打包服从持久批次边界**——被写后缓冲窗口或显式 flush 分开的兼容连续段会保留为不同物理记录；这以打包率受时序影响为代价，避免改写既有行。
- **同步压缩**——Node 的 SQLite 与 Zstandard 调用都会阻塞 JavaScript 线程；4 KiB 阈值限制了小型记录的逐 frame 工作。
- **`DatabaseSync` 会阻塞事件循环**——减少物理行不会使 SQLite 操作变为异步。
- **繁忙等待会阻塞事件循环**——SQLite 会在同步 `DatabaseSync` 调用内等待；只有繁忙的 journal-mode 切换会在两次尝试之间让出执行，而且从打开时计算的截止点只阻止新尝试，不会中断正在执行的调用。
- **外部 SQL 读取方必须理解物理标签**——受支持的消费方通过本提供方读取，而不是把每个 `events.type` 都当作逻辑事件类型。
- **没有删除或后台历史压缩**——普通追加只做插入。
