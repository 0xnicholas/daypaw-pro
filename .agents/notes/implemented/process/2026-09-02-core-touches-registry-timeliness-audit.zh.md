# Agent Note: CORE_TOUCHES 登记簿全量路径时效审计

Status: implemented

[English](2026-09-02-core-touches-registry-timeliness-audit.md) | 中文

## Problem

CORE_TOUCHES 登记簿是同步仪式的重放清单（ADR 0001 §4）：每行登记一个上游自有文件及 fork 在其上的改动，仪式在每次合并后逐条重验。重验成立的前提是每行指向现存路径、且所述改动仍落在树里。[前端架构复盘](../../../../docs/reports/2026-09-02-frontend-arch-review.md)的抽查发现一行指向改名前的路径；issue #91（wayfinder #81 裁决 2）要求对登记簿做全量校验，而非只修抽查行。

## Decision

审计以 2026-08-28 上游 checkpoint（`cd5ef81481`）为基准做双向核对：每行命名的路径必须存在且所述改动仍在；每个被 fork 改动的上游文件必须被某一行或该行的连带集认领。发现与修正均已落进登记簿：

- built-boot 行：路径更正为 `apps/web/tests/built-boot.expected.e2e.ts`（上游 expected-output 改名；「Waiting for approval」编辑在改名后存活）。
- ui-theme 行：dialog golden 路径随同一次上游搬迁跟进（`snapshots/` → `expected/`）；`src/client/settings-store.ts` 与 `apply.client.spec.ts` 撤出连带集——两文件经 2026-08-28 sync 取上游演化版后与上游逐字节一致（`settings-store.client.spec.ts` 存活的 fork 编辑仅测试标题一句）。
- fixture.ts 行补认领自有 spec 伴生物 `packages/client/connection/tests/fixture.client.spec.ts`（callId 配对、fx-gamma question、`flipGammaRunning`、approvalHistory 折叠的断言随动）。
- 新增一行登记 `apps/web/tests/todo-row.expected.e2e.ts`（头注 turn 编号 74→75），与 built-boot 的适应性文本行同形。
- session-controller manager 行（#94）补认领文档伴生物：`service.ts` 的 `list` 字段 JSDoc 与 README 的 removal 帧重拉段。
- Issue 第 1 项（fixture-durable spec 迁出上游树）已随 #90 以 `git mv` 落地为 `apps/daypaw-web/tests/durable-rpc.spec.ts`；`packages/client/connection/tests/` 不再含 fork 新增文件。

未立行、留待 owner 另票跟进的上报项：无行认领的根脚本 fork 改动——`tsdown.config.ts`（types entry glob）、`scripts/gen-doc-graphs.ts`（durable 服务角色）、`scripts/test-invariants.ts` 与 `scripts/verify-built-package-invariants.mjs`（companion 缺席过渡）、`scripts/type-equiv.manifest.json`（daypaw-engine 文档配对）、`scripts/rescope-vendor.ts`（inspector wire-id skips）——以及再生的目录产物（`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`、`packages/extensions/tool-cordis/src/api-catalog.ts`、`docs/capability-seams*`、`docs/config-catalog*`、`docs/rescope*`、`docs/subsystems/README*`）。

## Alternatives considered

- **本次把所有未列 diff 一并立行。** 否决：这些编辑分属其他票的改动族，每行的原因列必须承载该族的裁决理由；裁决 2 将本次审计限定在路径时效。改为上报、留待后续票登记。
- **把再生目录产物算作登记触碰。** 否决：它们是 sync 时再推导的生成器产物（目录重生卫生提交 `72002c1945` 即先例）；登记行登记手工编辑，不登记派生产物。

## Consequences

- 登记簿全部路径在工作树中可解析、受触行的连带集与树一致，下一次 sync 对每行按现存路径重放。
- 未登记的根脚本改动在后续票登记前保持开放；sync 会以合并冲突或测试红暴露这些文件，而静默类（仅注释的适应性修改）由登记行覆盖。
