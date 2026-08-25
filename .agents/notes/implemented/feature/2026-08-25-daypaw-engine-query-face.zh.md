# Agent Note: daypaw engine query face (JournalStore read side)

Status: implemented

[English](2026-08-25-daypaw-engine-query-face.md) | 中文

## Problem

Issue #50（spec 05 §5 后端增量第一项）为产品壳的任务进度板块供数：run 列表带状态过滤、单个 run 的父子血缘、单个 run 的 journal step 时间线枚举。票继承的裁决是查询知识收进引擎缝——随 `SCHEMA_VERSION` 演进的单一事实源——host 侧 SQL 散点方案已否决。`JournalStore` 缝此前只载写侧加点查，读面需要设计：哪些方法、落在哪层、带什么排序契约，且呈现词汇（「任务」）不得泄进缝以下（issue #40）。

## Decision

缝恰好长出三个读方法，逐层原样暴露：

- **`JournalStore` 读侧** —— `selectRuns(filter?)`（新者在前，可选单一状态过滤）、`selectChildRuns(parentRunId)`（先来在前）、`selectJournalSteps(runId)`（开始顺序）。`SqliteJournalStore` 构造时一次性 prepare 各语句；`rowid` 把同毫秒时间戳决出真实插入顺序，快跑下「新者在前」依然稳定。无迁移：既有 `idx_runs_status` 服务过滤，其余查询在自用规模下都是主键或单列扫描。
- **core 委托 + 一处组合** —— `DurableEngineCore.listRuns` 与 `journalTimeline` 直转 store；`runLineage(runId)` 是唯一的组合，以 `selectRun` 加 `selectChildRuns` 一次调用回答「该 run 的父与子」，返回 `{ run, parent, children }`，runId 未知时各字段皆空。查询方法不带 disposal 断言：dispose 后可读与 `handle.status()` 先例一致，数据库可用性归其所有者裁决。
- **`ctx.durable` 异步包装** —— service 上的 `listRuns` / `runLineage` / `journalTimeline`，与其他方法一样生成进 cordis catalog。呈现词汇留在缝之上：行保持引擎原名（`run`、`journal`），「任务」措辞是 UI 投影的职责。
- **类型各归其层** —— `RunListFilter` 在 `seams.ts` 与缝同处，`RunLineage` 在 `core.ts` 与组合同处；行仍是 `@daypaw/store` 契约类型。catalog 生成器的 `TYPE_LINK_EXEMPTIONS` 把每个类型指向其 README 所有者。

## Alternatives considered

- **拆成 `getRun` 加 `childRuns` 两个 service 方法，而非 `runLineage` 组合** —— 否决：验收问的是「一个 run 的父子血缘」这一个问题，组合一次答完，且不必暴露需要 host 自行串接的裸行查询方法。
- **查询方法加 `assertNotDisposed`** —— 否决：读没有要保护的状态机，`EngineRunHandle.status()` 已有 dispose 后读 ledger 的先例；人为守卫只会打破这条对称。
- **迁移新增 `idx_runs_parent`** —— 否决：自用规模下子查询是有界扫描；索引待实测需求出现时以自己的迁移段落地。
- **经 `@daypaw/sdk` facade 暴露该面** —— 超出本票范围：消费方是 Cordis host；库消费方出现时 SDK facade 再镜像这些方法。

## Consequences

板块票（收件箱分组、右栏详情）不经 SQL 即可经 `ctx.durable` 读到全部所需，排序契约（run 新者在前、子先来在前、step 开始顺序）由测试钉死而非靠约定。代价：service 面多出三个方法，其行把引擎原始列名暴露给 host（可接受——host 是内部的）；子查询在量级证伪之前是无索引扫描。`@daypaw/store` 未动：契约行早已载有查询所需的每一列。

## Testing

`packages/daypaw/engine/tests/queries.spec.ts` 经 `ctx.durable` service 驱动全部三类查询（service → core → SQLite 一条路径）：五状态列表与过滤用例、父/子/未知 run 的血缘、completed 加 failed 的 step 时间线。engine 与 store src 保持 per-file 100% 覆盖率。

## Deferred

`parent_run_id` 索引与 `listRuns` 的分页/limit 待实测量级；SDK facade 镜像待库消费方出现。
