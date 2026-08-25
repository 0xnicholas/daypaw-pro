# Agent Note: agent run steer 通道——journal segment 行上的多段 run

Status: implemented

[English](2026-08-25-agent-run-steer-segments.md) | 中文

## 问题

spec 05 §5 后端增量第四项（issue #53）：对进行中 run 的追问追加进同一任务的对话流——不产生新任务，产出物只由终态 `output_json` 派生。此前 run 是单段的：启动时给输入，quiesce 时要么 `submit` 要么失败（[defineAgent 编译 note](../architecture/2026-08-22-define-agent-compilation.md) 的唤醒契约）。四个决策开放：追问在 ledger 里放哪、在跑的 body 何时消费、哪些定义种类可被 steer、opt-in 的 run 里不带 submit 的 turn 意味着什么。parked 等待的机械复用 [gate 原语](2026-08-23-durable-gate-waitfor.md) 的进程内直推 + `pollMs` 轮询先例，落在[走骨](../architecture/2026-08-19-daypaw-walking-skeleton.md) ledger 之上。

## 决策

- **段是 journal 行，不是迁移** —— `journal.kind` 列没有 CHECK 约束，`kind='segment'` 行零迁移落地：step 键 `steer:<seq>`（按记录序从 1 起；`steer:` 前缀与 step 键永不碰撞）、`occurrence=seq`、插入即 `completed`、`value_json` 为 JSON 输入。段 0 是 `runs.input_json`——隐式边界，永不成行。段是事实而非执行单元：任何重驱动都不重执行它。`@daypaw/store` 把 `JournalRow.kind` 放宽为导出的 `JournalKindDb = 'step' | 'segment'`；`JournalStore` 缝新增 `insertJournalSegment` / `selectJournalSegments`。
- **落账先于投递，三路唤醒** —— `DurableEngineCore.steer(runId, input)` 先落账再投递，随后直推本进程 parked body；跨进程 steer 由 parked 等待的 `pollMs` 轮询观察；无进程驱动期间落账的段由 boot 扫描重驱动消费。loud 失败先于任何写入：runId 未知、run 已终态、本进程已注册而未声明 `steerable: true` 的定义，均以裸 `Error` throw。调用返回从 1 起的段序号。
- **段边界消费，绝不轮内注入** —— body 以 `ctx.steers()` 读（纯读；跨重驱动的消费去重归 body 管），以 `ctx.awaitSteer(known)` park——与 gate 等待同构的零算力等待：已录段超过 `known` 时立即返回（先查后等不构成竞态），取消或销毁时 reject `RUN_CANCELLED` / `ENGINE_DISPOSED`，轮询同时观察他写者落下的行。parked run 的 ledger 状态保持 `running`——gate `waiting` 语义不动，对 gate 等待中的 run steer 只落账、不唤醒 gate。
- **仅 agent 可 steer，按定义 opt-in** —— `EngineDefinition.steerable?: boolean` 把守 `steer()`；`defineAgent({ steerable })`（默认 false）编译为段循环。不带 `submit` 收尾的 turn 让 run park 而非失败；每个已落账段在段边界以 user message 投递（`agent.steer`，JSON text，形状同初始输入），一次唤醒恰好跑一个 turn 到 quiescence，`maxTurns` 在每次唤醒前检查、跨段共享。重驱动按 session log 的 `user/message` 事件序数计已投递段（排除 RESUME_MESSAGE 唤醒——log 即回放源，崩溃不重复投递、内容相同的追问互不混淆）。复活三分支：进程死期间落账的段即唤醒（无合成 RESUME_MESSAGE）；干净 parked 的 run 复活即重新 park、不消耗 turn；崩溃发生在 turn 中途仍以 RESUME_MESSAGE 唤醒。`defineWorkflow` 没有 `steerable` 选项、也没有 workflow 消费糖——steer 按面仅属 agent；未声明的定义保持原语义不变：不带 submit 的 turn 使 run 失败，`ctx.agent` 子 run 因而不会挂住父 workflow。
- **wire 面沿用 `listDefinitions` 先例** —— `DurableEngine.steer` 携带 `@Remote('steer')`，API gateway 据此认领 `durable/steer`。Typert Remote 边界拒绝不受约束的 `unknown`，故 wire 输入是 `packages/daypaw/engine/src/types.ts` 新导出的 `Json` 联合；契约校验留在 SDK 面——`RunHandle.steer(input)` 先按定义的输入 schema 校验再调用（`RunHandle<T, I = unknown>` 新增输入类型参数）。

## 曾考虑的替代方案

- **`segments` 专表或给 `kind` 加 CHECK 的迁移** —— 否决：平行表为不新增的能力复制 journal 的排序与 run 联接；列上无 CHECK 使新 kind 零成本；`steer:` 键前缀在不引入新身份方案的前提下保持每 run 单一有序序列。
- **轮内 steer 注入**（打断在飞 turn 重新提示）——否决：它与部分 turn 叠加会撞上 model-visible means logged 不变量、为被中止的工作烧 token，且 dsh 本就在 quiescence 处投递 `agent.steer`；段边界消费保持一次唤醒 = 一个 turn，`maxTurns` 唤醒前检查因而精确。
- **workflow 消费原语**（第六 ctx 原语或 `defineWorkflow({ steerable })`）——否决：没有 workflow 调用方；且父子危害方向相反——永不 submit 的可 steer 子 run 会挂住等待中的父 run，故非 steerable 定义的 fail-on-no-submit 原样保留。
- **parked run 专有 ledger 状态**（与 `waiting` 并列的 `parked`）——否决：steer park 是 body 内部等待，没有可命名的外部 referent；以 `running` 加段行作为可观察事实，`RunStatus` 与呈现词汇不变。

## 结果

用户可以 steer 一个活体 agent run，且 run 跨段扛住进程死亡：ledger 按序持有每个输入，session log 持有每条已投递消息，复活时两者按序数对账。SDK 的类型化 `steer` 先校验再调引擎；引擎的检查是 `ctx.durable` 直调方的 loud 兜底。覆盖：故障注入套件断言每个 steer 追加点（段列出、段插入、parked 等待的轮询各分支、重复 park 拒绝）；行为测试覆盖记录序、loud 失败、跨进程投递与 boot 扫描消费死前落账段；SDK 组合套件覆盖 park-而非-失败、三种复活分支与序数去重；daypaw-skeleton 示例证明 parked 态被真 SIGKILL 杀死后凭已落账段复活并完成。放弃：轮内 steering（steer 等待当前 turn quiesce）、workflow 可 steer 性（无任何面开放）、独立 parked 状态（host 看到的是 `running` 加段行）。按需缓议：workflow 调用方出现时的消费原语，以及任何轮内打断语义。
