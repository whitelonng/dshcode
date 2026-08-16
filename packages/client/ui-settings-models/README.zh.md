[English](README.md) | 中文

# @deepseek-ai/dsh-client-ui-settings-models

模型设置与产品引导插件。同一个 client Cordis 插件注册「模型」页与两个有序首启对话框：带版本的内测通知与条件性的官方 DeepSeek 凭据步骤。两者共用同一弹窗外壳，由 `settings.onboarding` 排序。模型平面把三个线域并入同一共享快照——`llm.providers`（可配置 provider 目录，含每个路由的活动/休眠状态）、`settings.describe`（序列化 schema、分层脱敏值、密钥槽）与 `credentials.describe`（不含值的已配置/来源/可写徽标）——每次渲染一个 provider 行加一个编辑器卡片，不把路由活跃度呈现为 provider 状态。

行是*已配置*的 provider（其 profile 在所属命名空间中解析）；整段 provider 的密钥在任何地方都未配置时，以打开的设置卡片而非行呈现——但仅限首启姿态——直到用户关闭该卡片，之后它变回带缺失密钥圆点的普通行。每种卡片自持打开状态，关闭一个不会丢弃另一个中的草稿。添加流程是携带休眠目录 provider 选择的卡片——裸挂载的 `llm-pi-ai` 在任何路由存在前就提供其整个已安装 catalog。pi-ai 卡片还编辑该路由的**模型列表**，并可询问 provider 提供什么。行只在引用凭据确认已配置时显示绿色实心点，只在命名引用确认缺失时显示红色实心点；引用无关的 provider 原生认证与不可用的凭据富化保持无标记。编辑器按适配器家族手写：主字段是单个 **API key** 输入——页面从不询问环境变量名；键入的密钥经 `credentials.set` 以 profile 的引用**只写**存储，profile 无引用时派生 `<ROUTE>_API_KEY`，pi-ai profile 把该派生记录为 `apiKeyEnv`，因此 `settings.yaml` 永不携带密钥值。新 pi-ai provider 的密钥留空会保存无引用 profile，从而保留 provider 原生认证（如 Bedrock 凭据链或 Vertex ADC）。成功的 Apply 发出本地可访问状态消息，不回显密钥材料。折叠的「自定义设置」承载精选扩展——两个家族的 `baseURL`（deepseek 占位符显示公共端点）、各适配器的模型 catalog，以及适配器不内置的 pi-ai 路由的**显示名称**与 **API 协议**。Provider ID 保持不变：它是 settings 键、其他命名空间与每个已记录会话引用的名称，也是页面无法读回迁移的凭据引用之干。推理等级刻意不在其中：它是每模型能力，同一 provider 下的模型对接受的等级意见不一，provider 级控制只能设为其中一些模型拒绝的值。作曲器的模型选择器为每个模型提供各自等级，那里的切换把 provider、模型与等级一起记录为下个会话的默认。DeepSeek 每行编辑 `id`、可选显示 `name` 与可选 `contextWindow`/`maxTokens`；该精选集合之外的既有字段在编辑中保留。行仅在用户层单独持有时可删除（删除恢复组合基线），其本地化确认对话框在标题、描述与最终动作中命名 provider。目录条目说明所属适配器在该键下未内置任何东西时，行标记 **Custom**。

通知步骤在 `src/onboarding-copy.ts` 持有其精确文案与版本。在回环上通过既有 settings API 比较并写入 `ui-onboarding.welcomeNoticeVersion`；只有显式 Continue 记录当前版本。非回环浏览器无法使用该 Host 专属命名空间，因此确认仅进程内，通知在重载后再次出现。DeepSeek 步骤从同一合并快照投影首启就绪：任何已可达 provider 都不渲染地结束它；只有全无的用户才被询问官方 DeepSeek 密钥。

每次编辑都以 `settings.mutate` 路径操作落盘——变更字段一次 set、清空字段一次 unset、删除 provider 行一次 unset。DeepSeek 的 `models` 是整值替换数组：首次模型编辑把完整数组物化到用户层之前，编辑器显示继承的有效行；reset 取消该覆盖。容量以带可选 `K`/`M` 后缀的数字键入（`256K`、`1M`）并按普通计数存储，以最短可往返形式回拼。空 id、重复 id、空显式名称与不可读、非正或小数的容量在任何写入前失败。键入的 API key 按字段自身判断：去空白后必须非空且每个字符为可打印 ASCII（`[\x21-\x7E]`）——与 `@deepseek-ai/dsh-llm` 的 `normalizeApiKey` 同构。每次 settings 写入携带卡片当前 `revision`，并发写入或外部 `settings.yaml` 编辑以 `settings-conflict` 拒绝；settings 提交后卡片先采纳返回的脱敏用户子树与 revision 再存凭据。删除仅在 profile 命名页面派生的 `<ROUTE>_API_KEY` 目标时移除已配置、可写的凭据，然后 unset profile；两者幂等，部分失败留在可识别的确认对话框内重试。页面订阅 `settings/document-updated`、`credentials/updated`、`llm/adapters-updated` 与本地 `connection/reset`，外部编辑与第二标签页无需轮询即可收敛。

## 模型列表与端点询问

pi-ai profile 的 `models` 列表在卡片上编辑：每行一个模型，显示 id 与显示名，上下文窗口与输出上限位于行级展开区，右侧两个无标签动作——展开与删除。空列表表示「服务该路由的内置 catalog」，行只会被刻意添加；清空容量即丢弃它；适配器的路由级回退为配置留空的部分定尺寸——空容量把回退数量显示为占位符（提示而非镜像，因为字段按 1000 计 `K`）。非正整数的容量不存储。

**获取可用模型** 询问 `llm.discoverModels` 关于表单**当前显示**的端点——包括已编辑未保存的 baseURL 与已键入未存储的密钥。回复打开选择器而非直接写入：已配置的候选默认未选中。无法询问的 provider 是绕路而非死路——适配器自身消息出现在行旁，行仍可手编。

**添加自定义 provider** 声明 pi-ai 不内置的路由。它是独立卡片：路由 id 在此选定，settings 地址此前不存在——一次 `settings.mutate` 在 `providers.<route>` 设置整个 profile。无法默认的门槛拦住创建按钮——唯一 **Provider ID**、端点、协议与至少一个唯一标识模型。id 必须以小写字母开头，因为它也是派生凭据引用的干。容量不设门槛。协议选择从命名空间自身 schema 读出，不会与适配器接受的漂移。profile 写入成功但密钥写入失败时，provider 已存在：卡片落定描述字段，单独重试凭据，并报告已创建的 provider。

**推理等级声明** 让手工声明的第三方模型在作曲器的模型选择器中提供思考等级。每个模型行的展开区带一组复选框拼写声明——pi-ai 编辑器列出全部 pi-ai 等级（`off` 至 `max`），DeepSeek 编辑器列出直接 DeepSeek 协议可分派的三个——外加「禁用推理」复选框（`false`）。勾选一个等级即以既有线上拼写加入，或在新勾选时用协议默认拼写（等级名本身；`off` 保持为空——「支持、不发送」）；取消则移除该等级，取消最后一个等级即得 `false`。pi-ai 组旁还会显示协议族提示（例如 OpenAI-completions 建议 `minimal` 至 `high`），仅供参考。声明写入适配器读取的同一 `providers.<route>.models[].reasoningEfforts`。「高级」折叠保留原文本输入（`high: high, max: ultra`——「等级: 拼写」对，逗号分隔），自定义线上拼写的部署不会丢失；不可读文本停靠为无效哨兵，共享模型校验在任何写入前拒绝。留空则把模型的推理能力交给已安装 catalog（或保持缺失）。

**能力复选框**（仅 pi-ai 模型行）声明模型选择器加徽标的三种主张：**图片输入**切换条目 `input` 中的 `image`（以 `text` 为下限），**生图**切换新 `output` 数组中的 `image`，**识图**切换 `capabilities.imageUnderstanding`——并且，因为能理解图片内容的模型必然要收到图片，同时让 `input` 保留 `image`。生图保持独立：会画图的模型不必接受图片。取消生图或识图会整体删除对应字段；直接 DeepSeek 编辑器不渲染能力复选框，因为其协议线只支持文本、图片走 note 策略且由适配器硬编码。

## 模型体验

无。本 section 渲染浏览器配置 UI；不触及模型请求。

#### KV 缓存影响

无。本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **卡片只编辑 API key 与精选折叠字段**——手写编辑器以 mockup 布局换取 schema 泛型字段覆盖（[Agent Note](../../../.agents/notes/implemented/architecture/2026-07-30-web-config-plane.md)）。两个家族暴露 `baseURL` 与模型 `id`/`name`/`contextWindow`/`maxTokens`；pi-ai 行还暴露能力复选框（`input`/`output`/`capabilities`）与推理等级复选框，DeepSeek 行暴露 `off`/`high`/`max` 等级组，手工声明的 pi-ai 路由还暴露 `displayName` 与 `api`。重试策略、超时、DeepSeek 模型描述等高级字段留在 `settings.yaml`；编辑器不显示的既有模型字段被保留。
- **凭据清理刻意收窄**——删除行仅在引用恰为页面派生的 `<ROUTE>_API_KEY` 目标时移除已配置、可写凭据。自定义引用、环境凭据与不可识别目标被保留。
- **只有 pi-ai 路由可手工声明**——自定义 provider 卡片写入 `llm-pi-ai`。
- **询问覆盖 OpenAI 兼容端点**——适配器只读该模型列表响应格式，其他协议的网关报告无法询问，其模型手工录入。
- **未声明的活跃路由无处呈现**——无可配置 provider 声明的路由没有 settings 地址；它在选择器中可见但不在此页行中。
