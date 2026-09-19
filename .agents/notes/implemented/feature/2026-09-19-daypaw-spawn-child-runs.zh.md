# Agent Note：子 run 的耐久派发——`ctx.spawn` 与取消级联

Status: implemented

[English](2026-09-19-daypaw-spawn-child-runs.md) | 中文

## Problem

ADR 0003 定下五个 ctx 原语，`ctx.spawn` 却是空白：spec 02 §2 写着「spawn 语义未设计」（ADR 0010 §4 排除），引擎 README 承诺它「随其状态机按需落地」（[ticket #125](https://github.com/0xnicholas/daypaw-pro/issues/125)）。

缺口比看上去窄。子 run 早已有两种等待式形态（`ctx.agent` 与 `ctx.step` 内裸 `run()`），ledger 早已记 `parent_run_id` / `parent_step_key`，`runLineage` 早已读这两者，boot 扫描早已复活每个未完 run 且不问其父是谁。火后不管甚至已经能跑：在 `ctx.step` 里启动子 run 并丢弃 handle——两层都已标记 result 承诺为已处理，不会崩。

缺的不是机制，而是三件有名有姓的事：一个说「把这活分离出去」而不是「忘了 await」的 API；一份呈现层能读的派发事实（spec 05 §2 早已承诺 spawn 子在父详情里单列一节）；以及没人问过的生命周期问题的答案——父的终局对仍在跑的子意味着什么、子的失败对父意味着什么、作者一次能起多少个。

设计过程中还浮出两处相邻缺陷。保留的 step 族键按每次 body 执行的平面调用计数，而重驱动会跳过每个已完成步的 `fn`——于是被跳过的步之后调用的原语会重新派生**更早**的序号：spawn 会 attach 到错误的子，sleep 会读到已 fired 的 timer 行、穿过一次它从未经历过的唤醒而返回。而取消父从不触碰子：操作者取消的 run 可能留下一个仍在烧 token 的子 agent，被 boot 扫描永远复活，且从 UI 不可达——看板隐藏子 run，落在已终态父上的 `cancel` 提前返回。

## Decision

- **`ctx.spawn(def, input): Promise<string>` 是一等原语，其派发事实住子 run 行**——子在保留键位（`spawn:<n>`；步内为 `<stepKey>/spawn:<n>`）下启动，落 `parent_run_id` / `parent_step_key`，使用的正是等待式惯用式早已派生的确定性 runId。零新 journal kind、零新表、零迁移、零 wire 变化：子 run 行**就是**记录，重驱动走同一调用序就重派生同一 id，start-or-attach 因此 attach 而非重复 spawn。
- **await 一次 spawn 等的是子的启动，从不是它的结果**——调用只返回子的 runId。不给 handle、不给 `result`、不给 `cancel`：分离才是重点。观察仍归等待式形态；观察或 join 一个已 spawn 的 run 是未来的原语，留口。
- **取消一个 run 即取消其未完结子树**——`cancel(root)` 先写自身终态行、结算自身 pending gate，再递归每个未完结子孙；已完结的子孙一字不动。`done` / `failed` 永不级联：子是独立义务，继续跑、照旧被 boot 扫描复活。对已终态 run 的 `cancel` 仍然级联，这正是「停掉这摊活」对「父已完成、spawn 子仍在跑」的孤儿态可达的原因。
- **子的失败永不进父的失败面**——父的 `status` 与 `output` 是它自己的；失败子经父详情所读的血缘可见。
- **v1 无并发上限**——spawn 不新增等待式惯用式本就没有的资源类别（`Promise.all` 跑子 run 同级），而无队列的上限只能拒绝、不能节流。记为已知限制并附触发条件。
- **保留键位按作用域计数**——顶层保持 `sleep:<n>` / `spawn:<n>`，步内调用记在该步名下（`<stepKey>/sleep:<n>`），每个作用域各一份计数器，被跳过的步再也挤不掉外层调用的序号。`ctx.sleep` 在同一改动里改用同一条规则。
- **呈现与 wire 不在本次改动内**——`WireRun` 增加 `parent_step_key`、壳的 spawn 子任务节、看板列表行都归壳侧；ledger 现在已备好它们需要的事实。

## Alternatives considered

**在子 run 行之外再落一行 `kind = 'spawn'` 的 journal 行。** 它能把「在此处派发」放进父的 step 时间线。否决：子 run 行已以父链承载同一事实，这等于把一份事实写两遍；且新 kind 会流进 `durable/journalTimeline`，浏览器面闭集 `JOURNAL_KINDS` 解析器与壳的渲染 switch 必须同车随动——两写之间还多一个崩溃窗口要重驱动去弥合。

**薄糖，或干脆不设原语。** 把 `ctx.spawn` 做成「一个 step 里启动子 run 并丢弃 handle」并不比手写代码多出任何能力；把「在 step 里启动且不 await」写成惯用式，则让 spec 05 §2 的呈现承诺失去供数：ledger 里没有任何东西能把 spawn 子与父正在等待的子区分开。

**只读 handle（`{ id, status(), cancel() }`）。** 否决：spawn 面上的 `cancel()` 会把「父拥有此子的生命周期」悄悄写进原语，与本原语赖以存在的分离相抵。父真要停掉子，那是取消级联——或未来原语——该做决定的地方。

**在引擎 `run()` 里拒绝「父已终态或不存在」的子启动。** 这能关掉「已取消的 body 仍能插入子 run」的竞态，却与既有契约冲突：引擎刻意允许在已结算父下记录父子链（血缘读面及其测试构造的正是这个形状），而「父已完成、子仍在跑」是设计内的状态，不是错误。守卫因此移到 SDK 的 `ctx.spawn`：司机信号一旦 abort 即拒绝。

**每父级或每引擎的并发上限。** 阈值没有消费者可供校准；全局上限是引擎级的运维考量，与 daemon 化将要替换的那三条可替换缝同处一层——不该由 spawn 的定义偷渡进来。

**给 run 行加一列 `spawned`。** 与 `parent_step_key` 上的 `spawn:` 前缀重复，而前缀已是唯一事实。

## Consequences

- 五原语家族齐备：`ctx.step` / `ctx.sleep` / `ctx.waitFor` / `ctx.agent` / `ctx.spawn`。
- 取消现在意味着「这个 run 及其未完结子树」。这关掉了一个比 spawn 更早存在的洞——被取消的父留下的等待式子 run 仍在跑——并给操作者一条停掉「活得比父长」的子 run 的路。
- `sleep` 的键只在嵌套调用时改变形状：顶层 `sleep:<n>` 行保持原键，步内的 sleep 现在记 `<stepKey>/sleep:<n>`。
- 没有任何模型可见之物改变：无新会话事件、无 `SESSION_FORMAT_VERSION` 变更、无 wire 变化。agent 类定义的 spawn 子仍各拥一个会话（sessionId ≡ runId），因此它在会话平面上与任何子 run 别无二致。
- 司机侧的取消路径与其失败孪生一样降级：记录取消时的 store 故障只记警告，绝不把 run 的 result 承诺挂在半空。操作者路径（`cancel()`）仍然响亮——调用方得知子树走查失败，而被寻址 run 的停止已经落定，随后一次 cancel 扫掉故障跳过的那部分。
- 覆盖率保持 per-file 100%：`engine/tests/cancel-cascade.spec.ts` 四例（深级级联、已完结子孙不被动、已终态父的孤儿清扫、调用方信号路径），`sdk/tests/spawn.spec.ts` 七例（派生 id 与血缘、重驱动 attach 不重复、失败不到父、父取消随动、已取消 body 被拒 spawn、未绑定定义 loud、类型面双族）；`sleep.spec.ts` 增键作用域用例与错位回归各一，故障注入套件增子树走查的两个窗口。变异探针确认：关掉级联、把键位退回平面计数、或移除司机侧守卫，这些测试都会红。
