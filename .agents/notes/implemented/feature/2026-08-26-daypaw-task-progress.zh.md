# Agent Note: daypaw 任务进度板块（混合feed、详情栏、重试）

Status: implemented

[English](2026-08-26-daypaw-task-progress.md) | 中文

## Problem

Issue #57（spec 05 §2/§5，壳板块增量 ②）把收件箱板块变成任务进度面：「进行中/已完成」分组由 durable 引擎的查询面供给，右侧详情栏承载四个区块（进度 / 子任务 / 产出物 / 审批历史），失败的 run 提供「重试」。[引擎查询面](2026-08-25-daypaw-engine-query-face.zh.md)已给 host 提供 `listRuns`/`runLineage`/`journalTimeline`，但浏览器只能走 gateway 的 Typert Remote 通道（[agent 目录](2026-08-25-daypaw-agent-catalog.zh.md)的约束），且[任务对话](2026-08-24-daypaw-task-conversation.zh.md)的板块只认识 session——workflow run 没有 session，纯 sessions 板块永远列不出它。

## Decision

- **混合 feed：板块行 = 顶层 run ∪ 无 run 的 session** —— `projectInboxBoard`（ui-inbox `task-projection.ts`）把 `durable/listRuns` 的 ledger 行与 sessions 列表合并：子 run 永不上板（它们活在父 run 的血缘下）；agent run 认领其 session 孪生（其 runId 即 session 身份，同 id 会重复列出）；空 session 是草稿而非任务。run 行仅在孪生确已列出时携带 `sessionId`——`sessions.open` 对未列出的 id 会 loud 失败——因此点击已列出的 agent run 走 sessions.open 打开其会话，无孪生或 workflow run 走新的 run 选中（`{ kind: 'run', runId }`）进入详情栏。
- **`rerun` 是真正的引擎动词，不是 UI 桩** —— `DurableEngineCore.rerun(runId)` 有四道守卫（未知 run、非终态、子 run、定义未注册，全部 throw），随后经与 `run()` 启动分支共享的 `insertAndDrive()` 抽取插入一行新记录——定义身份与输入相同、`attempt = 源 + 1`、`retried_from_run_id = 源`——并立即驱动。子 run 守卫是承重的：对子 run 重试会把 attempt 链从父 run 的 step journal 上扯脱，应重试顶层 run。服务方法携带 `@Remote('rerun')`（`listDefinitions` 先例），三个查询方法同样补上标记，浏览器由此触达 `durable/listRuns` / `durable/runLineage` / `durable/journalTimeline` / `durable/rerun`。wire 边界：`RunLineage` 成员是 `... | null` 而非 `undefined`——Typert Remote 类型必须经受 JSON，而 JSON 丢弃 undefined 值的键；`@daypaw/store` 新增零运行时 `./types` 子路径转出行类型，因为 Typert 分析器扫描的是声明所属包的 exports 子路径。
- **审批历史是经 session 事件喂养的 session 投影单元** —— 新 host 包 `@daypaw/approval-history` 把 `approval/asked` + `approval/decided` 审计事件对折叠成 `ctx.sessionProjections` 上的 `approvalHistory` 单元（`stateVersion: 1`）；详情栏的「审批历史」区块经标准 `useProjection` 席位读取。该审计事件对本身就是「模型可见 ⟺ 落日志」的记录，投影不引入新事件。
- **对 spec §5 的偏离：浏览器轮询 Remote 端点** —— spec 的字面设计是 host 轮询加 mux 投影。session 投影严格按会话隔离，它与 session 作用域的 mux 通道都承载不了跨 run 的板块。因此 ui-inbox 的 `RunsBoardStore` 每 `RUNS_BOARD_POLL_MS`（2000——WebBootEntry 启动图没有逐插件配置通道，该节奏是产品常量）轮询 `durable/listRuns`，`TaskDetailStore` 在选中时加载血缘与时间线。fixture 应答全部四个 `durable/*` 端点，各客户端通道保持免密钥。
- **详情栏以选中态为键，绝不以 session 席位为键** —— `'details'` 槽是严格 session 作用域，选中无 session 的 workflow run 时席位可能带着陈旧会话，因此 `TaskDetailView` 从工作台选中态派生，绑定 session 的区块只在席位 sessionId 与选中匹配时才读它。ui-inbox 的 `TaskDetail` 渲染头部（run 标题、严格状态文案、失败 run 的「重试」按钮），正文委托给新槽 `'inbox.detail.body'`，由 ui-tasks 的 `DetailBody` 占据并渲染四个区块：workflow 进度是 journal step 时间线，agent 进度是对话的最后三条业务行；子任务是血缘子 run；产出物是解析后的 `output_json`。`ctx.spawn` 尚未实现，spec 里独立的「spawn 子 run」区块并入单一的子任务区块。

## Alternatives considered

- **纯 sessions 板块** —— 否决：workflow run 没有 session；板块会静默丢掉 spec 的第二种 run。
- **照字面实现 spec §5 的 host 轮询 + mux 投影** —— 以当下不可能否决：session 投影严格按会话隔离，跨 session 的 mux 投影不存在，跨 run 板块没有会话可挂。浏览器轮询即上文记录的偏离；跨 session 投影通道落地后板块可迁过去，端点不动。
- **UI 侧重试（重新提交输入）** —— 否决：重试是引擎语义（attempt 链、`retried_from_run_id`、boot 扫描复活）；客户端重新创建会分裂事实源，还会丢掉详情栏渲染的血缘。
- **`RunLineage` 缺席成员用 `undefined`** —— 否决：JSON 丢弃 undefined 值的键，wire 值会与声明类型不一致；`| null` 让 Typert 边界保持诚实。

## Consequences

板块以一份投影同时列出两种 run 与无 run 的 session，详情栏按选中展示进度/子任务/产出物/审批历史，重试产生可见的 attempt 链——全部由 `task-progress` 快照通道免密钥钉住。代价：一个新 host 包及其接线（tsconfig reference 与 paths 映射、knip 条目、cordis.patch 名册行、web-app 依赖、CORE_TOUCHES 登记）、一处上游 fixture 改动、2 秒浏览器轮询（无推送通道），以及一个仅为 Typert 分析器存在的 `@daypaw/store` `./types` 公共出口。

## Testing

ui-inbox 规格覆盖 wire 边界解析器（全部拒绝分支）、板块与详情 store（generation 竞态、轮询生命周期、重试后的板块 kick）、混合投影合并、状态词汇表与详情栏；引擎 `rerun.spec.ts` 经服务驱动四道守卫与 attempt 链；fixture 规格钉住四个 `durable/*` 端点；`apps/daypaw-web/tests/task-progress.snapshot.ts` 经组装后的 web 应用录制板块与详情 golden。

## Deferred

「等待你确认」分组保持占位零，直到审批板块票（#58）接上待决交互；`ctx.spawn` 的子 spawn 面随原语本身落地；推送式板块刷新等跨 session 投影通道；workflow run 没有 session，其「审批历史」区块只能渲染空态 —— workflow 级审批呈现等 run 级（而非 session 级）审批通道。
