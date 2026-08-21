# dsh-authorization

[English](README.md) | 中文

授权 Service Definition（`ctx.authorization`）。有些凭据无法配置，只能获取：拿到它意味着与人对话——打开这个页面、粘贴那个码、选一个账号。本 seam 拥有这段对话及其生命周期，但从不拥有协议本身。

**flow 是某个插件"如何取得自己那份凭据"的知识。** 它以自己写入的 [`CredentialKey`](../credentials/README.zh.md#two-key-spaces-two-questions) 注册，因此 flow 声明了自己产出哪条记录，并通过该键的 scope 声明由哪个插件为记录内部的格式负责。第二种授权协议以另一个 flow 的形式到来，而不是另一个 seam。

**写入由 flow 拥有。** `run()` 返回即表示记录已经通过 `ctx.credentials` 提交；seam 核实的是它在本次尝试期间观察到的提交——只看记录存在与否，会让重新授权把陈旧记录冒充成新鲜的——并拒绝那些返回时没提交记录的 flow。让提交发生在 flow 内部，才能使一个通过自有 store 适配器持久化的库保持为唯一写入方，而不是把凭据复制出来再写第二遍。

**交互随请求传入，而非注册表。** 发起授权的一方才是能与人对话的一方，因此提示恰好抵达发问的那个界面，无头调用方则传入一个直接拒绝的交互实现。这样既不存在"环境提供方缺席"的问题，也不会出现某个提示该归两个已打开页面中哪一个的疑问。

## 接口

```ts
import type { Context } from '@deepseek-ai/cordis'
import { AuthorizationDeclinedError, type AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'

declare const ctx: Context
declare const exchange: (signal: AbortSignal) => Promise<void>

const key = credentialKey('llm-pi-ai', 'openai-codex')

const dispose = ctx.authorization.registerFlow({
  key,
  label: 'ChatGPT (Codex)',
  methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
  async run(session: AuthorizationSession) {
    session.notify({ message: 'Continue in your browser', url: 'https://auth.example/start' })
    const code = await session.prompt({ kind: 'text', message: 'Paste the code' })
    // Commits the record through ctx.credentials before resolving.
    await exchange(session.signal)
    void code
  },
})

ctx.authorization.list()                    // [{ key, label, methods, inFlight }]
ctx.authorization.describe(key)             // the same entry, or undefined
await ctx.authorization.begin({             // { status: 'authorized' | 'cancelled' }
  key,
  interaction: { notify: () => {}, prompt: () => Promise.reject(new AuthorizationDeclinedError()) },
})
ctx.authorization.cancel(key)               // withdraw whatever is running for the key
dispose()
```

同一个键同时只允许一次尝试。第二个调用方会收到 `ALREADY_IN_FLIGHT` 拒绝而不是被并入：否则两者会通过同一个 flow 向不同的人发问，而第二个人回答的是问给第一个人的问题。`inFlight` 放在 entry 上，界面据此把按钮渲染为禁用，而不是靠报错才发现。

`cancel(key)` 与请求自带的 signal 并存，是因为请求/响应式传输要用第二次调用来响应"取消"按钮，而它拿不到第一次调用的 signal。注册在尝试进行中被 dispose 的 flow 也以同样方式撤销：它的执行体属于一个正在离开的插件。

调用方在发起前就已撤销的尝试，既不占用该键也不启动 flow——若指望每个 flow 都在首个 await 之前检查自己的 signal，那么没有检查的那个就会占着键一直挂起。校验仍然先执行，因此调用方给出的键或方法不存在时，无论它是否已经放弃都会收到报错。

人的"不"是一种结果，不是故障。选择拒绝的交互实现让 prompt 以 `AuthorizationDeclinedError` 拒绝，在提示被拒之后才失败的尝试以 `cancelled` 结算，与 signal 撤销完全一致；其余任何 prompt 拒绝仍是抵达调用方的 flow 故障。notice 依同一原则即发即忘，并由 seam 兜底：渲染不了 notice 的界面丢掉的是那条 notice，而不是整次尝试。

`authorization/settled (key, settlement)` 在键释放之后触发，覆盖每一种终态。`settlement` 在 `begin()` 能返回的两种状态之外增加了 `failed`：失败以抛出的错误抵达其调用方，因此事件流是未发起该尝试的旁观者唯一能区分"被拒绝"与"出故障"的地方。监听器故障被就地遏制：每个监听器都会执行，抛错或拒绝只记录日志、不改变已结束尝试的结果，仅 `INVARIANT` 编码的故障在其余监听器执行完后重抛。

## 交互词汇

notice 是单向的，且从不携带机密：一条消息，以及可选的"人需要打开的页面"和"需要在该页面输入的码"。prompt 是 flow 无法自答的问题——`text`、`secret` 或 `select`——其中 `secret` 与 `text` 的差别仅在呈现方式。prompt 自带 `signal`，使得一个让手输码与浏览器回调赛跑的 flow 可以在尝试继续的同时撤下落败的那个问题；撤销整次尝试则用请求的 signal。

这套词汇刻意小于任何单个 provider 的词汇：它描述的是界面必须渲染什么，因此能渲染一个 flow 的界面就能渲染全部 flow。

## Model Experience

无，因为授权是配置期与人的对话，flow、notice 与 prompt 都不会抵达模型请求。

#### KV Cache effect

不失效；任何授权状态都不会进入请求前缀。

## Known Limitations and Deferred Work

- **flow 不可恢复** —— 一次尝试只存活于发起它的进程中，因此登录途中刷新浏览器会丢弃它，人需要重来。可持久的尝试需要一个本 seam 并不具备的存储。
- **没有吊销** —— 登出即 `ctx.credentials.deleteRecord(key)`，它只遗忘本地记录而不通知签发方。需要服务端吊销的 provider 目前无处声明这一点。
- **没有 flow 的键是惰性的** —— seam 只报告已注册的内容，因此被卸载插件遗留的记录可以删除但无法重新授权。识别这种孤儿记录由调用方自行 join，与 [`listRecords()`](../credentials/README.zh.md#surface) 的情况相同。
