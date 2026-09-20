# Agent Note: built-boot 烟雾随常驻问句的载体会话路由

Status: implemented

[English](2026-09-14-built-boot-question-carrier.md) | 中文

## Problem

web 浏览器快照道仅有的交互烟雾（`apps/web/tests/built-boot.expected.e2e.ts`）以 `Unable to find role="button" and name "Skip this question"` 失败，这处红被车道饿死（[#111](https://github.com/0xnicholas/daypaw-pro/issues/111)）掩盖。上游烟雾（上游 `d419b722bb`）开 fx-alpha、跳过 fixture 三问、再放行其审批——上游 fixture 把常驻问句与审批都归属 fx-alpha。fork fixture 把常驻问句归属 fx-gamma（[#58](../feature/2026-08-26-daypaw-approval-board.zh.md)），使问句徽章不在 daypaw 板上遮蔽审批徽章，烟雾的行徽章相应钉在 `Waiting for approval`；fork 基点早于上游循环落点，2026-08-28 sync 因此把该循环原样合并回 fork 归属之上。待决交互挂载在载体的会话上（composer 链按当前打开会话的键解析待决交互），问句 composer 在 fx-alpha 视图里挂不起来，该循环不可满足。

## Decision

- 烟雾覆盖两个交互各自的载体行：fx-gamma 的 `Waiting for answer` 行经真实 composer 链跳过三问，fx-alpha 的 `Waiting for approval` 行放行其审批，随后接续未变的 ContextMeter/diff/web 行/CSS 断言。
- 改道新增的等待全部带该文件的显式 10 秒超时：默认 1 秒的 `findBy` 短于负载机器上挂载所需的时间。
- 议题里的两条端点假设排除为成因：问句 → 审批 → 上下文的完整旅程在共享 fixture 上跑绿，且 `dynamicCordisRunner/*` 端点无应答、亦无 [#90](../architecture/2026-09-06-durable-fixture-decorator-transport.zh.md) durable 装饰器——两者维持其现有的受控警告与 daypaw 本地面地位。

## Alternatives considered

**把常驻问句在 fixture 里迁回 fx-alpha。** 否决：这会丢掉 #58 的徽章遮蔽保证（runtime 行徽章优先取问句，daypaw 等待你确认板将失去审批键），且钉住 fx-gamma 归属的 fixture spec 与 daypaw golden 会转红。

**经 API 而非 UI 作答问句。** 否决：该烟雾证明构建束端到端挂载问句 composer；API 作答会删掉该道对此路径的唯一覆盖。

**恢复仅审批的循环并断言问句 UI 不挂载。** 否决：生成的 roster 确会挂载问句 UI；断言其缺席会把烟雾削弱到低于上游自身烟雾的覆盖。

## Consequences

- 该道的常驻交互烟雾经构建图锻炼两种交互：fx-gamma 上的问句 composer 与 fx-alpha 上的审批卡。
- `docs/fork/CORE_TOUCHES.md` 该文件行登记 delta（徽章文案加载体路由），sync 仪式据此重放，而非原样合并上游 hunk。
- [车道 note](../testing/2026-08-30-coverage-gate-main-ci-lane.zh.md) 载该道当前状态；fork issue #114 跟踪 hosted 连续两跑绿的验收。
