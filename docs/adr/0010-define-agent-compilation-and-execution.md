# ADR 0010: defineAgent 编译与执行模型

- **状态**：已接受（2026-08-19，`/grill-with-docs` 会话十一裁决）
- **前置**：ADR 0003（编程模型、定义注册表、幂等 start-or-attach）、ADR 0006 §2（注册表不透明记录）、spec 01（引擎语义）、spec 02 §1/§2（workflow 面与原型定案）
- **事实底座**：dsh 源码复盘——`packages/bundle/headless/src/index.ts`（create→followup→whenIdle→按 seq 切片汇总的一次性驱动先例）、`packages/core/agent/src/runtime-types.ts`（send/steer/followup 全部强制携带 UserMessage；whenIdle 语义）、`packages/core/agent-loop/src/agent.ts`（idle/turn 相位机、rejected step 关 turn 不留 step）、`packages/core/agent-loop/README.md`（llm-retry 瀑布恢复坐标、step 内并行调用池）

## 决策

### 1. 引擎盲：SDK 编译 spec 为不透明 body（裁决 1、2）

`defineAgent` 返回声明式定义（name+version+zod IO+组合行）；`bindAgent(def, ctx)` 编译它——内部闭包捕获宿主 Context，从 `ctx.durable` 取引擎、`ctx.agents`/`ctx.agents.resume` 取挂载面、`installModelSelection` 挂 ModelRoute（headless bundle 同式）——产出 `(ctx, input) => Promise<output>` 的不透明 thunk 交给引擎注册表。引擎不新增对 `kind='agent'` 的任何理解（沿 ADR 0006 §2）；冷复活零改动（注册表仍拿 body）。workflow 的 `bind(def, engine)` 不动：两个绑定面反映真实差异——纯耐久 vs 需要 LLM 世界。

否决：引擎原生展开 LLM 循环（违反注册表不透明；引擎被拖回刻意避开的领域）。

### 2. 去重粒度：一个 dsh step = 一条 journal step（裁决 3、5、6）

dsh step（一次组装 + 可能多路并行模型调用 + 工具执行）映射为一条 journal step，记录值 = 该 step 的完整结果上下文。submit 工具约定终止：SDK 注入 `submit` 工具（args schema = output schema），handler 捕获+校验值，模型收到 submit 工具结果后自然收尾（多付一次廉价 completion）；`agent/pre-step` rejection 式零成本终止（省该次 completion）留为实现期优化。输入 = JSON 序列化后的首条 user message（`followup(createUserMessage(...))`，headless 原式）——model-visible→logged 零成本，静态组合行不掺数据。maxTurns 到顶 = journal failed → run failed。

### 3. session 接回与复活编舞（裁决 4、11）

sessionId = runId 恒等派生（`SessionId` 为编译期 brand 无格式校验）。首驱动 = `agents.create`；复活 = `agents.resume` 续接历史，journal 已完成 step 回放省下模型调用。**dsh 无无内容唤醒**（send/steer/followup 均强制 UserMessage）：复活后向 idle agent `steer` 一条合成续跑消息（标注进程重启、继续当前任务）——诚实于上下文（重启是真实事件），保住 A′ 的全部经济学。接受崩溃半轮留下的冗余失败尝试留在上下文（dsh 崩溃修复合成收尾闭合它）。

### 4. 组合缝：子 run 模型（裁决 7、8、9）

`ctx.agent(def, input)` = 语法糖：SDK 从 `(parentRunId, stepKey, occurrence)` 派生确定性子 runId（与子 workflow 惯用式共享同一机制），启动子 agent run（`parent_run_id` 落账）、await 类型化结果。agent 直呼与被调账目同形（ledger 只认 run）；两级各自耐久（父步去重 attach 子终态；子 run 半途死由 boot 扫描复活）。agent run 的 session 身份是恒等式不冗余存储（runs 不加列）；journal 行携 `(session_id, session_seq)` 双向引用（列已在）。里程碑范围：defineAgent + bindAgent + 派生机制 + `ctx.agent` + 子 workflow 惯用式一次落齐；`ctx.spawn` 排除（语义无人设计、无消费者——按需落地裁决拦截）。

否决：内联模型（父 journal 混编排与推理；直呼与被调账目异形）。

### 5. 重试分层（裁决 10）

轮内 LLM 瞬态失败归 dsh llm-retry 瀑布（adapter 层不可变 policy、请求级恢复坐标），对引擎不可见——重试不产生新 step、不污染 journal 的 occurrence 序（幂等键稳定性是硬理由）；step 级失败（重试耗尽、工具校验反复失败、maxTurns）才落 journal failed → run failed。spec 01「LLM 级重试留 dsh llm-retry waterfall」钉到 step 粒度。

否决：引擎级 LLM 重试记账（复制 dsh 成熟件；occurrence 序污染破坏幂等键）。

## 后果

- spec 02 §1.2/§2 回填（类型面从原型分支折入正典）；CONTEXT.md「Agent 定义」词条磨利。
- 实现批次：SDK 编译器 + bindAgent + submit 注入 + 复活编舞 + 确定性子 runId 派生 + `ctx.agent`——走骨已验套路（状态机测试 + 故障注入覆盖 + REAL-composition）。
- 依赖假设已核销：headless 先例证实宿主组合件清单（agent-loop、llm+provider、session 持久化后端、sessions）；REAL-composition 测试的 cordis.yml 须含 persistence 后端（resume 路径的前提）。
- 合成续跑消息进入模型上下文 = defineAgent 的诚实代价，写进 spec 02 运维注记。
