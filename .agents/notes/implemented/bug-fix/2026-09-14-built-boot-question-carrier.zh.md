# Agent Note: built-boot 烟雾随常驻问句的载体会话路由

Status: implemented

[English](2026-09-14-built-boot-question-carrier.md) | 中文

## Problem

web 浏览器快照道仅有的交互烟雾（`apps/web/tests/built-boot.expected.e2e.ts`）在 [#111](https://github.com/0xnicholas/daypaw-pro/issues/111) 解除车道饿死后持续红：`Unable to find role="button" and name "Skip this question"`。上游烟雾（上游 `d419b722bb`）开 fx-alpha、跳过 fixture 三问、再放行其审批——写于上游 fixture 的世界，那里常驻问句与审批同骑 fx-alpha。fork 的 [#58](../feature/2026-08-26-daypaw-approval-board.zh.md) 把常驻问句迁至 fx-gamma，使问句徽章不在 daypaw 板上遮蔽审批徽章，并把烟雾的行徽章断言改为 `Waiting for approval`；fork 基点早于上游循环落点，无冲突可见。2026-08-28 sync 随后原样合并回上游的问句循环、同时保留 fork 的 fx-gamma 归属：待决交互挂载在载体的会话上（composer 链按当前打开会话的键解析待决交互），问句 composer 永远不会在 fx-alpha 视图里挂载，该循环永远不可满足。饿死的车道把这个合并产物藏到了首次 hosted 执行。

## Decision

- 烟雾在行面钉住归属拆分——fx-alpha 载 `Waiting for approval`、fx-gamma 载 `Waiting for answer`——随后在各自载体上驱动交互：开 fx-alpha（聊天内容）、路由到 fx-gamma 的徽章行经真实 composer 链跳过三问、返回 fx-alpha 放行审批，再接续未变的 ContextMeter/diff/web 行/CSS 断言。
- 新增等待全部带该文件的显式 10 秒超时；失败的那处等待原是全文件唯一的默认 1 秒 `findBy`。
- 议题里的两条端点假设被排除为成因：探针在共享 fixture 上（`dynamicCordisRunner/*` 端点仍无应答、亦无 [#90](../architecture/2026-09-06-durable-fixture-decorator-transport.zh.md) durable 装饰器）把问句 → 审批 → 上下文的完整旅程跑绿，两者维持其原有的受控警告与 daypaw 本地面地位。

## Alternatives considered

**把常驻问句在 fixture 里迁回 fx-alpha。** 否决：逆转 #58 的徽章遮蔽动机（runtime 行徽章优先取问句，daypaw 等待你确认板将失去审批键），并使钉住 fx-gamma 归属的 fixture spec 与 daypaw golden 重新转红。

**经 API 而非 UI 作答问句。** 否决：该烟雾存在的意义就是证明构建束端到端挂载问句 composer（transport → 远端事件 → 待决交互 → composer 链）；API 作答会删掉该道对此路径的唯一覆盖。

**恢复循环前的形态并断言问句 UI 不挂载。** 否决：生成的 roster 现已挂载问句 UI；断言其缺席会把烟雾削弱到低于上游自身烟雾的覆盖。

## Consequences

- 该道的常驻交互烟雾现在经构建图锻炼两种交互——fx-gamma 上的问句 composer、fx-alpha 上的审批卡——而非仅审批一种。
- `docs/fork/CORE_TOUCHES.md` 该文件行登记扩展后的 delta（徽章文案加载体路由），sync 仪式重放这一适配，而非再次原样合并上游 hunk。
- [车道 note](../testing/2026-08-30-coverage-gate-main-ci-lane.zh.md) 的「持续红」事实随本变更更新；fork issue #114 跟踪 hosted 连续两跑绿的验收。
