# Agent Note：浏览器平面载入控制器（`@daypaw/client-load`）

Status: implemented

[English](2026-09-17-daypaw-client-load-controller.md) | 中文

## 问题

fork 壳 store 里七处手写的载入路径重复同一仪式：代际计数 +1、写 loading 状态、await wire 取数、仅当这次尝试仍是最新时才落笔。`RunsBoardStore` 与 `TaskDetailStore`（[`@daypaw/ui-inbox`](../../../../packages/daypaw/ui-inbox/README.zh.md)）、`CatalogStore`（[`@daypaw/ui-agents`](../../../../packages/daypaw/ui-agents/README.zh.md)）、`AboutStore`、`ApiKeyCardStore`、`CredentialsStore`（[`@daypaw/ui-settings`](../../../../packages/daypaw/ui-settings/README.zh.md)）与 `NewTaskStore`（[`@daypaw/ui-tasks`](../../../../packages/daypaw/ui-tasks/README.zh.md)）各持一份规则，每份三个守卫点——成功、失败，以及「被顶替的尝试两者都不写」这层判断。规则很容易做对一半：守住成功写、却让迟到的拒绝把状态画成 error，是同一个 bug 换了个更安静的症候。

测试也按同样的方式重复。六个 spec 文件里十三条 staleness 用例，其中十二条是同一断言换个 store 再写一遍。本仓自己的克隆检测器完全看不见它：`jscpd`（minLines 6、minTokens 60）全树报零克隆，因为这份重复是语义级的——每一行载荷都不同，骨架却共享。

## 决策

`@daypaw/client-load` 拥有这条规则，而且只拥有这条规则（[票 #118](https://github.com/0xnicholas/daypaw-pro/issues/118)）。`LatestLoad<S>` 包住 store 的 `SnapshotStore`：`run(fetch, policy)` 为一次尝试取一个代际号、同步执行策略的 `start` 写、await 取数，然后仅当这次尝试仍是最新时才让它落笔——被顶替的尝试返回时一字未写，数据与拒绝一视同仁。`invalidate()` 作废在飞尝试而不发起新的，用于清空/选择路径。每 store 一个实例、持整个 store 生命周期；计数就是实例自己的状态。

store 留下真正属于自己的部分：取数、投影进自己的快照、以及状态策略——何时显示 `loading`、某次刷新是否保住屏上的 `ready` 数据（`RunsBoardStore` 在轮询 tick 时、`TaskDetailStore` 在同 run 刷新时）、失败写什么（仅 error 状态、带错误文案、或黄卡刻意保持沉默）。这些差异是真实的领域差异，因此留在调用点作为三段策略钩子，而不是变成通用控制器的参数。控制器对状态、错误文案、取消、在飞共享、缓存一概没有意见。

家取 fork 局部而非上游，因为上游贡献通道不存在：`deepseek-ai/deepseek-harness` 的 CONTRIBUTING 明写当前不接受外部 pull request，其 issues 关闭，历史上每一次 merge 都来自内部 `deepseek-harness/*` 分支。因此把模块加进 `@deepseek-ai/dsh-client-store` 换不来上游采用，却要付 ADR 0001 §4 登记的 core-touch 成本：一个上游文件，每次同步仪式逐条重放验证，且那个包上游大约每月都要动一次。上游自己在至少六处手写同一守卫（`ui-model-selection/catalog.ts`、`ui-settings/settings-mirror.ts`、`ui-settings-models/store.ts`、`ui-message-feedback/dialog.ts` 等），所以如果上游哪天长出自己的抽象，本包就是在下次 sync 退役的候选——README 记下了这个触发条件。

测试按同样的切法。`@daypaw/client-load` 自己的 spec 覆盖行为矩阵——两条顶替路径、将被顶替的那次也照跑 `start`、可选钩子、`invalidate()` 在飞与空转——适用 fork 的 per-file 100% 覆盖率门（本包在 `ui-*` GUI 债豁免之外，故门自动适用）。各 store 只保留一条接线断言：经它自己的入口路径重叠载入时旧者不得获胜——这是「每次调用新建控制器」会静默引入的唯一失效，也是 store 其他 spec 从不触及的唯一并发性质。余七条陈旧性用例：本包的行为矩阵加各 store 的一条接线断言。

## 考虑过的替代方案

**把控制器加进上游的 `@deepseek-ai/dsh-client-store`。** 它是 `shallowEqual` 与 `createSnapshotStore` 的天然邻居，上游也确实有同一模式的真实消费者。它输在贡献通道上：没有对外 PR 路径时，该改动就是上游已发布包里的 fork 私有分歧，登记为 core touch、每次 sync 重放，而它唯一的收益——将来被上游采用——本地包靠一句记录在案的退役触发同样拿得到。

**复用既有的 fork 包：`@daypaw/durable-client`、`@daypaw/ui-inbox` 或 `@daypaw/ui-settings`。** 三者都已在消费方的依赖表里，放在任何一处都不新增建制成本。但每一处都是 durable-client 裁决已经否决过的 locality 错位：第一个是 durable wire 词汇的家，CONTEXT.md 的词条得扩写到能涵盖 store 结算；另两个是功能包，而 `ui-settings` 里已经住着 tab 专用的 `lazy-refresh.ts` 约定。跨插件机制寄居功能包还会把今天 type-only 的 `ui-inbox` 依赖变成值依赖。

**只抽一个守卫对象（`begin()` 返回带 `settle`/`fail` 的尝试）。** 更小，且各 store 的 `try`/`catch` 留在原地。它比看起来更薄：store 仍可在自己的 `catch` 块里不咨询尝试就写状态，于是不变量恰好在最要紧的地方变成建议性的。

**让控制器拥有四值 status、只收投影。** 五个普通 store 的接口会缩到 `run(fetch, { success })`，另为刷新期保 `ready` 的两个 store 配一个旋钮。代价是给每个采用者强加状态字段契约，并把两处真实的策略差异塞进参数，换来每个 store 省两行。

**保留七份守卫，只共享测试。** 参数化 staleness 套件能在不建包的前提下消掉测试重复。但不变量仍留在七个代码家、二十一个守卫点，票的另一半——各 store 缩到取数与投影——也就不会发生。

## 后果

- 代际计数只有一个家；六个 store 文件各持一个 `LatestLoad` 字段，其 `load`/`select`/`fetch` 方法体读起来就是取数加策略。可观测行为不变：全部 66 条 store spec 对着这六个 store 通过。
- 测试从六个文件十三条 staleness 用例，变为七条接线断言加本包的行为矩阵，后者由覆盖率门保持全分支覆盖。
- 登记：`tsconfig.client.json` 一行引用（追加进既有 CORE_TOUCHES 条目）与一对包 README；spec 05 §5 承载 spec 依据句，ADR 0014 记录家的裁决，CONTEXT.md 新增「载入控制器」词条。
- 包名刻意不取 `ui-*`：`packages/daypaw/ui-*/src/**` 豁免是给 GUI 债的，纯结算规则归 per-file 门。
- 壳里没有任何东西依赖本包的**身份**：各插件的浏览器 bundle 各内联一份副本，对一个无状态规则是正确的，客户端模块表零变化。
