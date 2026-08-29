# dsh-credentials

[English](README.md) | 中文

凭据 Service Definition（`ctx.credentials`）。一条准则，三个推论：

**配置只携带对机密的引用，绝不携带机密本身。** settings 分节或 `cordis.yml` 条目写 `apiKeyEnv: DEEPSEEK_API_KEY`，引用背后的值存放在凭据提供方处。于是设置文档可以放心同步、放心渲染进配置界面；`describe()` 无需持有值就能回答「配置了吗、来自哪层、能否写入」；轮换机密不触碰任何配置文件。

**消费方按操作解析。** `resolve(ref)` 在每个操作开始时调用（LLM（大语言模型）适配器每次模型请求解析一次），绝不跨操作缓存——正是这次读取让改过的凭据无需重启任何插件就作用于下一次请求。

**空的存储值等于不存在。** 处处如此：`resolve` 跳过它，`describe` 报告未配置。空白永远不会伪装成已配置的机密。

<a id="two-key-spaces-two-questions"></a>

## 两个键空间，两个问题

`CredentialRef` 回答的是*这个环境变量名背后是什么*，分层覆盖进程环境、托管存储与 `.env` 文件。以上全部描述的都是这一半。

`CredentialKey` 回答的是*某个插件为某个 id 持有什么凭据*。这里没有任何东西可以分层——授权 grant 没有可供读取的环境——因此记录的存在与否就是全部事实，空值规则在此不适用：一条既无 key 也无环境值的 `api-key` 记录，陈述的是其拥有者确认该路由靠 ambient 认证，这属于已配置。

键的形式是 `<scope>/<id>`，其中 `scope` 是**拥有该记录的插件的注册名**。scope 取拥有者而非领域，是因为 `grant` 的 payload 以其拥有者的格式写就：否则服务同一个提供方名称的两个插件会互相读到对方的 payload，而已卸载插件留下的记录也无法与仍在使用的区分开。`/` 同时让两种文法互斥，两个键空间因此不可能相撞。id 来自别处的消费方——settings dict 键、某个库自己的 provider id——应先问 `isCredentialKeySegment` 再构造键：文法之外的 id 不可能存过记录，应读作「没有存储任何东西」，而不是在寻址上抛错。

<a id="surface"></a>

## 接口

```ts
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'

declare const ctx: Context

const ref = credentialRef('DEEPSEEK_API_KEY')            // POSIX shell identifier, branded
const hit = await ctx.credentials.resolve(ref)           // { value, source } | undefined
const info = await ctx.credentials.describe(ref)         // { configured, source?, writable } — never the value
await ctx.credentials.set(ref, 'sk-…')                   // rejects while a read-only source shadows the ref
await ctx.credentials.unset(ref)                         // no-op when absent; same shadowing rule

const key = credentialKey('llm-pi-ai', 'openai-codex')   // <owner>/<id>, branded
await ctx.credentials.readRecord(key)                    // CredentialRecord | undefined
await ctx.credentials.describeRecord(key)                // { configured, kind?, writable } — never the value
await ctx.credentials.listRecords()                      // [{ key, kind }] — never values
await ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { token: '…' } }))
await ctx.credentials.deleteRecord(key)                  // no-op when absent
```

`modifyRecord` 是唯一写路径，因为正确的写入依赖当前值：刷新 token 是「读—决定—替换」，变更函数必须看到写入取得独占那一刻的记录。独占跨进程成立，这正是防止两个进程同时轮换同一个 refresh token、丢掉先写那一个的机制。变更函数返回 `undefined` 表示保持原状，不写盘也不发通知。

`listRecords` 存在，尽管引用那一半刻意不提供枚举。引用可以从 settings schema（`apiKeyEnv` 字段）被发现；记录没有这条路径，无法枚举的界面就无法显示用户已授权了什么，也找不到已卸载插件留下的孤儿。

`grant` 记录的 `payload` 是不透明的：seam 从不读取、校验或重塑它。唯一约束是它能经受 JSON 往返，提供方在写入与读出两个方向都强制这一点——存储无法逐字读回的值会被拒绝，而不是有损地存下。

`credentials/reference-updated (ref)` 在提供方管理的来源发生已提交变更后触发——`set`、`unset` 或在存储中观察到的外部编辑。进程环境变量的变化不可观测，永不触发。消费方不需要该事件（它们按操作重新解析）；它服务于配置界面刷新「已配置」徽标。它的声明住在 client-safe 的 `./types` 子路径出口，与其点名的 `CredentialRef` 类型同处一处（包根继续 re-export 该类型），于是 Host 编译面之外的消费方读到的正是 Host 发射的那一份签名，而不必再写一遍。

`set`/`unset` 的遮蔽规则有意采用明确报错的方式：当只读来源（本地提供方中即当前进程环境）正在提供该引用时，写入会表面成功而解析仍返回遮蔽值——seam 选择直接拒绝，并通过 `describe().writable` 让界面提前把该引用渲染为只读。

## 提供方

[`dsh-credentials-local`](../credentials-local/README.zh.md) 把继承的进程环境叠加在其受管 `$DSH_HOME/.credentials.yaml` 文档之上，并以启动器的项目和用户 `.env` 层作为后备。该 seam 的接口为 keyring、辅助命令和 KMS 后端提供方预留了扩展空间；远端设置提供方永远不必携带机密。

## 模型体验

经由消费它的 LLM 适配器间接生效：解析出的值为适配器的提供方请求授权，所有模型可见接口都由适配器负责。

#### KV Cache 影响

无直接失效；凭据绝不进入请求前缀。

## 已知限制与暂缓事项

- **引用不提供枚举**——seam 只回答被问到的引用；配置界面从 settings schema 得知引用集合，对这一半做 `list()` 没有当前消费方。记录出于上文的理由则可枚举。
- **引用限定为环境变量形状**——单一扁平的 POSIX 标识符命名空间，因为引用同时就是它借以解析的环境变量名。记录使用更丰富的 `<owner>/<id>` 寻址。
- **进程环境变化不可见**——不可能为其发事件；界面只能在自身导航时重新读取 `describe()`。
- **记录的拥有者就是它的 scope，而没有任何环节核验该 scope 是否已挂载**——seam 存下被交予的内容，并报告它存了什么。识别孤儿是调用方在 `listRecords()` 与拥有该 scope 的注册表之间做的连接；seam 自身没有可供核对的注册表。
