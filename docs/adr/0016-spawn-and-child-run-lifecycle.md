# ADR 0016: spawn 与子 run 生命周期——五原语补齐与取消级联

- **状态**：已接受（2026-09-19，[引擎第二波：ctx.spawn 语义设计（火后不管子 run；spec 02 记「未设计」）+ 同票落地](https://github.com/0xnicholas/daypaw-pro/issues/125)）
- **前置**：ADR 0002（嵌入式引擎、step 去重续跑、boot 扫描复活）；ADR 0003（五原语表与 run 生命周期）；ADR 0010（确定性子 runId 派生与 `ctx.agent`）；ADR 0012（定义注册表）
- **事实底座**：`runs.parent_run_id` / `parent_step_key` 落账与 `runLineage` / `selectChildRuns` 读侧（[#50](https://github.com/0xnicholas/daypaw-pro/issues/50)）已在；boot 扫描对任何未完 run 独立复活、不分父子（spec 01 §5）；`ctx.step` 内启动子 run 而不 await 今天就能跑（引擎与 SDK 两层都已标记 result 已处理，不留未处理拒绝）；`EngineRunOptions.parent` + 显式 `runId` 已支持带父链 start-or-attach；journal 的 `kind` 在浏览器面是闭集且 fail-loud 解析（`@daypaw/durable-client`），新增 kind 必须随动 wire。

## 决策

### 1. `ctx.spawn` 是一等原语；派发事实住子 run 行的父链

`ctx.spawn(def, input): Promise<string>`——占一个保留的 step 族键位（`spawn:<n>`，与 `sleep:` / `steer:` 同类），按调用序派生确定性子 runId（与 step 内裸 `run()` 同一形状），带父链 start-or-attach，返回子 runId。**派发事实 = 子 run 行的 `parent_run_id` + `parent_step_key = 'spawn:<n>'`**：零新 journal kind、零新表、零迁移、浏览器面零波及；重驱动按同一调用序重派生同一 id 并 attach，绝不重复 spawn。

否决「journal 落一行 `kind='spawn'`」（双账）：同一事实写两处（子 run 行已载父链），新 kind 会流进 `durable/journalTimeline` 而闭集解析器与壳渲染 switch 必须同票随动，双写之间还多一个崩溃窗口。

### 2. await spawn 等的是「子已落账启动」，不是「子已结束」

返回值只有子 runId——不给 handle、不给 `result`、不给 `cancel`。要分离用 spawn，要观察用等待式惯用式（`ctx.agent` 或 `ctx.step` 内裸 `run()`）；观察/join 一个已 spawn 的子 run 需要新原语，留口，按首个真实用例再裁。返回 id 是 body 唯一能拿到子身份的通道（body 无 ledger 读口），用于关联、排障与呈现。两种定义都收（agent 与 workflow）——ledger 只认 run。

### 3. 取消级联：进入 `cancelled` 的 run 递归取消其未完结子孙

`cancel(root)` 在写自身终态行、结算自身 pending gate 之后，递归对每个未完结子孙执行同一写；**已完结子孙一字不动**——取消从不改写已发生的事。**终态不级联**：`done` / `failed` 永不牵连子 run，子是独立义务，继续跑、继续被 boot 扫描独立复活。**对已终态 run 的 `cancel` 也级联**：操作者的「停掉这摊活」在任何时刻可达，处理的正是「父已完成、spawn 子仍在跑」的孤儿态。级联对已取消子树幂等（终态读取短路）。

否决「只级联 spawn 子」：同一个 `cancel` 对两种子含义不同，而父取消时正在等的那个等待式子 run 恰恰也会被留下（本次补掉的正是这个既有孤儿空洞）；否决「一律不级联」：`cancel` 是操作者唯一的停止指令，点完「已取消」不等于活停下来。

### 4. 子 run 的失败不进父的失败面

spawn 子的 `failed` / `cancelled` 不改父的 `status` 与 `output`；父的结局只由自己的 body 决定。失败子经父子链在父详情可见（呈现词汇归壳，见决策 7）。

### 5. v1 无并发上限

spawn 不新增资源类别（与 `Promise.all` 跑等待式子 run 同级）；v1 无 task queue / worker（ADR 0003 §5），任何「上限」只能拒绝不能节流，真背压需要队列。记 Known Limitation，触发 = 首个真实过载事故，或首个跨进程 worker 形态（那时队列与上限一起设计）。

### 6. 键按作用域派生：`sleep` 与 `spawn` 同一条规则

保留键位按**环境步作用域**计数：顶层 `<kind>:<n>`，步作用域内 `<stepKey>/<kind>:<n>`，计数器按作用域各一份（`EngineStepCtx.slot`）。修掉既有缺陷：已完成步的 `fn` 在重驱动时被跳过，而平面计数器会让其后调用的原语取到更早的序号——`spawn` 会 attach 到错误的子，`sleep` 会读到已 fired 的行而提前返回。`ctx.step` 自身免疫（调用总发生、只有 `fn` 被跳过）。

### 7. 呈现与 wire 不落本票

`WireRun` 暴露 `parent_step_key`、壳侧「spawn 子任务单列一节」（spec 05 §2）与分类事实（`spawn:` 前缀）都留到壳侧首个消费；本票只把呈现所需的事实在账目里备好。列表行不加「有未完结子」角标——spec 05「列表只显示顶层任务」不在此单方面修订。

## 考虑过的替代方案

**薄糖（`ctx.spawn` = 一个 step 里启动子 run 并丢弃 handle）或不设原语（把「step 内不 await」写死为惯用式）**：两者不增加任何能力（今天手写即同效），且区分不出「spawn 子任务」与「等待式子任务」——spec 05 §2 已承诺的呈现没有供数。**返回只读 handle（`{id, status(), cancel()}`）**：`cancel()` 在原语层默认了「父拥有子生命周期」，与本决策的分离立意相抵。**在引擎 `run()` 上把「父已终态/不存在」判为失败**（原语层守卫）：与既有契约冲突——引擎允许在已终态父下记录父子链（血缘读侧与查询面依赖该形状），且「父已完成、子仍在跑」是设计内的合法态；防「已取消的 body 继续派发」的守卫改由 SDK 的 `ctx.spawn` 承担（`ctx.signal.aborted` 即拒）。**每父级或每引擎并发闸**：阈值无消费者可校准，且全局并发闸是引擎级运维维度（worker 化/daemon 化的三缝旁），不该由 spawn 定义偷渡。**给子 run 行加「spawned」列**：与 `spawn:` 前缀重复，前缀已是唯一事实。

## 后果

- 五原语谱系补齐：`ctx.step` / `ctx.sleep` / `ctx.waitFor` / `ctx.agent` / `ctx.spawn` 全数落地；spec 02 §2 与 ADR 0003 §2 的「spawn 未设计」字样消失。
- 取消语义扩展：`cancel` 从「一个 run」变成「一个 run 及其未完结子树」；等待式子 run 的孤儿空洞随之关闭（该空洞先于 spawn 存在）。
- 键作用域化同时改 `sleep` 的既有键：顶层键不变（`sleep:<n>`），仅嵌套加作用域段（`<stepKey>/sleep:<n>`）。
- 事件面零变化、session log 零变化、`SESSION_FORMAT_VERSION` 不动；浏览器面零随动（无新 kind、无新列）。
- 文档随动：spec 01 §3.4/§5/§6/§9、spec 02 §2/§4/§7、spec 05 §2、engine/sdk README 双语、CONTEXT.md 词条、Agent Note 双语对。
- 测试面：`tests/cancel-cascade.spec.ts` 四例（深级级联、已完结子不被动、已终态父的孤儿清扫、调用方信号路径）与 `tests/spawn.spec.ts` 七例（派生 id 与父链、re-drive attach 不重复、失败不进父面、父取消随动、已取消 body 不派发、未绑定 loud、类型面双族）；`sleep.spec.ts` 增键作用域与错位回归两例。per-file 100% 覆盖率门保持。
