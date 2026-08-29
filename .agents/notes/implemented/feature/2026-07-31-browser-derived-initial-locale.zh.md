# Agent Note: 全新浏览器打开的设置语言由浏览器决定

Status: implemented

[English](2026-07-31-browser-derived-initial-locale.md) | 中文

## Problem

设置里的语言行在每一次首访时都以中文开场：`LocaleRuntime` 从 localStorage 读取 `dsh.locale`，读不到就直接回落到 `zh`。浏览器本已声明其使用者阅读哪些语言——`navigator.languages` 就是这份声明——而应用对此视而不见，于是英文读者迎面撞上一个中文产品，还得先找到一行中文标签的设置项才能脱身。回落值当时同时承担两份职责：既是无法解析出 locale 时的最后兜底，也是所有从未做过选择的用户拿到的答案。

读取浏览器修好了那些浏览器声明了本应用所提供语言的读者，但残余情形依然是错的：既不请求 `zh` 也不请求 `en` 的浏览器（`fr`、`de`）仍会回落到 `zh`。这些读者恰恰最不可能阅读中文。

## Decision

**暂定 locale 先经浏览器、再经 `FALLBACK_LOCALE`（`en`）解析；显式 Host 偏好会实时替换它。** `packages/client/locale/src/client/index.ts` 中的 `resolveInitialLocale()` 在服务构造时运行，并表达浏览器／回落顺序。随后，非阻塞 settings 生命周期会应用 `$DSH_HOME/settings.yaml` 中可选的 `locale.preference`；若该值缺失，则继续使用由浏览器派生的值。

**开场 locale 与字典回落值共用一个常量，因为两侧字典是对称的。** `FALLBACK_LOCALE` 同时回答「浏览器未声明任何本应用提供的语言时，界面以哪种语言开场」与「当前 locale 的字典缺失某个 key 时由哪本字典兜住」。这是两个不同的问题，若其中任一答案必须不同，拆成两个常量才是对的——但每一对已提供的 `zh`／`en` 字典都声明了完全相同的 key 集合，因此回落这一步总能解析成功，两个答案都是 `en`。残余情形指向英文而非 `zh`，是因为一个声明了本应用都不支持的语言的浏览器，其读者最不可能读中文。`scripts/locale-dictionary-parity.spec.ts` 为这个共用常量所依赖的对称性设了门禁：只加在一侧的 key 会让该用例指名失败，而不是日后在运行中的界面里显现为形如 `list.aria` 的裸 key。

**浏览器匹配按主子标签进行，且遍历有序列表。** `detectBrowserLocale()` 遍历 `[...(navigator.languages ?? []), navigator.language]`，返回主子标签命中已提供 locale 的首个条目，因此 `zh-Hans-CN` 与 `zh-TW` 同归 `zh`、`en-GB` 归 `en`；而只请求本应用不提供的语言（`fr`、`de`）的浏览器则什么都匹配不到，交由 `FALLBACK_LOCALE` 接管。`navigator.language` 排在列表之后，并兜住那些 Navigator 上没有 `languages` 的宿主——DOM 库把它标注为必然存在，所以这份容忍带一条窄口径 lint 例外，与 `localStorage` 守卫表达的环境边界不信任同源。

**判定浏览器用的是 `window` 而非 `navigator`。** Node ≥ 21 暴露全局 `navigator` 并报告机器自身语言，因此以 `navigator` 把关会让 node 启动客户端树时解析成机器语言，而非文档约定的回落值。以 `window` 把关可使所有非浏览器运行都停留在 `FALLBACK_LOCALE`。

**显式选择具有持久性。** `setLocale` 通过 Host settings API 写入，因此选过语言的用户可在共享同一 DSH home 的不同浏览器 origin 与系统语言之间保留原选择。没有任何代码把探测到的 locale 写回：探测在每次启动时重新推导，对「用户是否做过选择」这一问题始终不可见。

**`<html lang>` 跟随解析出的 locale，而所服务的 markup 做不到这一点。** `apps/web/index.html` 是一份静态文件，服务所有访问者，因此它声明什么都必然对某些人是错的：解析发生在客户端，在文档被解析之后。于是由 locale 插件依据当前 locale 设置 `document.documentElement.lang`——激活时设置一次，因为探测结果或已采纳的 Host 偏好可能已与 markup 不一致；此后每次切换再设置一次。markup 声明产品默认值（`en`），使启动前的文档不至于主动误导。无障碍技术与浏览器功能（发音规则、翻译提示、字体回退、拼写检查）都读取该属性，因此陈旧的值是在误报文档语言，而不只是看起来不整齐。该属性承载 BCP 47 标签而非应用内部的 locale id：单独的 `zh` 会使文字（script）含义不明，因此已提供的中文文案声明 `zh-CN`。

**浏览器 e2e 车道固定浏览器语言。** 断言中文文案的场景（`access-confirmation`、`models-settings`、`onboarding-deepseek-config`、`settings-chrome`）以 `apps/web/tests/support.ts` 的 `locale: ZH_BROWSER_LOCALE` 打开页面；`newEnglishPage` 声明 `en-US`。`settings-chrome.e2e.ts` 两次使用没有显式 locale 的全新 Host home：`en-US` 浏览器与 `fr-FR` 浏览器都会抵达英文界面。真正钉住回落值的是 `fr-FR` 那个场景——`en-US` 浏览器无论走探测还是走回落都会落在英文，因此只有本应用不提供的语言才能区分二者，而中文场景则证明探测仍然覆盖回落值。

## Alternatives considered

- **`Intl.DateTimeFormat().resolvedOptions().locale` 或单读 `navigator.language`**：两者都把用户的有序偏好列表塌缩成一个标签，于是 `['de', 'en', 'zh']` 的读者拿到的是 zh 而非 en。列表恰恰是浏览器这份声明里最值得读的部分。
- **首次启动即持久化探测结果**：那会把探测变成一次性事件，让一次陈旧的首访凌驾于此后改变的浏览器语言之上，也摧毁了整个解析顺序所依赖的区分——存储值将不再意味着「用户选了它」。
- **完整的 BCP 47 协商（`Intl.LocaleMatcher` 式查找、地区与文字权重）**：在只提供两个语言互异的 locale 时，主子标签匹配就是正确答案的全部；协商层只会带来无行为支撑、也无从测试的表面积。
- **为回落 locale 增加一个 Cordis 配置键**：此处部署之间并无差异——回落值是产品对「完全没有信号」给出的答案，不是旋钮。仓库策略把 `Config` 字段留给有当前消费方、且随部署变化的选择。
- **拆成两个常量，一个管开场 locale、一个管字典回落**：它区分了两个确实不同的问题，若两个答案不同也确有必要。但它们并不不同：字典是对称的，因此两者都是 `en`，第二个常量只会是同一个值的两个名字，外加一条无人强制的规则。对称性本身值得强制，所以直接为它设门禁。
- **开场用 `en`、字典回落仍保留 `zh`**：这看起来是保守选择，但在字典对称的前提下，它能解析的 key 与 `en` 完全相同，因此毫无收益；而在它真正会起作用的情形——某个 key 只存在于 `zh`——在整体英文的界面里渲染出中文文本，比让 reviewer 一眼看见裸 key 更糟。
- **让 e2e 车道的中文场景继续钉存储项（`dsh.locale=zh`）**：那会让套件保持绿色，却抹掉浏览器推导路径在组装后应用中唯一的运行处；改钉浏览器语言才能端到端地演练新的解析过程。
- **按请求服务 `<html lang>`，或干脆不管这个静态属性**：在服务端计算它需要用请求的 `Accept-Language` 去重新推导客户端本就会解析的结果，使同一条规则在两处重复，而且仍会输给服务端并不读取的存储偏好。放任其保持静态，正是该属性对某一种语言永远错误的原因。依据解析出的 locale 来设置，可保持单一真源。

## Consequences

- 来自英文浏览器的首访落在英文界面，中文浏览器落在中文界面，而两者皆未声明的浏览器落在英文而非中文界面。语言行依然呈现同样两个以自身语言自述的选项，两个方向的脱身通道都未改变。
- 字典解析方向发生反转：当前 locale 缺失的 key 现在回落到 `en` 而非 `zh`。在字典对称的前提下，没有任何已提供的 key 行为发生变化——这正是那道对称性门禁存在的原因：它是这次反转所依赖的前提。
- `<html lang>` 现在在两个方向上都如实报告屏幕上的语言，这也关闭了 [#2160](https://github.com/deepseek-harness/deepseek-harness/issues/2160)。若某个客户端从未激活 locale 插件，则保留所服务的默认值，因此该属性退化为旧的静态行为，而不会退化为空值。
- 客户端树的非浏览器运行（node 启动、非 jsdom 单测车道）现在以 `en` 开场。断言已提供中文文案的用例必须在其构造的 runtime 上显式调用 `setLocale('zh')`；套件级的 `usePinnedBrowserLanguages('zh-CN')` 仅在同时声明了 `@vitest-environment jsdom` 的文件中生效，因为没有 `window` 时探测路径根本不会读取 `navigator`。此前有七个 `*.client.spec.ts` 文件带着这样一条失效的固定语句，实际依赖的是旧的 `zh` 回落值。
- 探测的代价是每次服务构造遍历一次数组，且不会隐式写入 settings；插件激活后，显式 Host 偏好可能引发一次实时收敛。
