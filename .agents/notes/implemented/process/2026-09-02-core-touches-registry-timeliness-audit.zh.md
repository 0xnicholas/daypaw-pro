# Agent Note: CORE_TOUCHES 登记簿全量路径时效审计

Status: implemented

[English](2026-09-02-core-touches-registry-timeliness-audit.md) | 中文

## Problem

CORE_TOUCHES 登记簿是同步仪式的重放清单（ADR 0001 §4）：每行登记一个上游自有文件及 fork 在其上的改动，仪式在每次合并后逐条重验。重验成立的前提是每行指向现存路径、且所述改动仍落在树里。有一行命名的路径与其所描述的文件不符（[前端架构复盘](../../../../docs/reports/2026-09-02-frontend-arch-review.md)），可见今天可解析的路径仍可能在合并后失效；全量登记簿承担同一风险，只抽查一行不能立稳该不变量（issue [#91](https://github.com/0xnicholas/daypaw-pro/issues/91)，wayfinder [#81](https://github.com/0xnicholas/daypaw-pro/issues/81) 裁决 2）。

## Decision

以 2026-08-28 上游 checkpoint（`cd5ef81481`）为基准，两个方向必须成立：每行命名的路径存在且所述改动仍在；每个被 fork 改动的上游文件被某一行或该行的连带集认领。下列登记行即这次修正的结果：

- built-boot 行：路径为 `apps/web/tests/built-boot.expected.e2e.ts`，该行的编辑是含「Waiting for approval」一行的预期 built-boot 文本。
- ui-theme 行：dialog golden 路径为 `expected/`；`src/client/settings-store.ts` 与 `apply.client.spec.ts` 与上游逐字节一致、无 fork 编辑，故不在连带集内；`settings-store.client.spec.ts` 的 fork 编辑仅测试标题一句。
- fixture 行补认领其自有 spec 伴生物（`tests/fixture.client.spec.ts`，随 fixture 一并退役）（callId 配对、fx-gamma question、`flipGammaRunning`、approvalHistory 折叠的断言随动）。
- 新增一行登记 `apps/web/tests/todo-row.expected.e2e.ts` 的头注，该头注声明当前 turn 值；该行与 built-boot 的适应性文本行同形。
- session-controller manager 行（#94）补认领文档伴生物：`service.ts` 的 `list` 字段 JSDoc 与 README 的 removal 帧重拉段。
- fixture-durable spec 现住 `apps/daypaw-web/tests/durable-rpc.spec.ts`；`packages/client/connection/tests/` 不再含 fork 新增文件。

下列 fork 改动尚无行覆盖，在后续票点名其改动族之前保持未登记：根脚本——`tsdown.config.ts`（types entry glob）、`scripts/gen-doc-graphs.ts`（durable 服务角色）、`scripts/test-invariants.ts` 与 `scripts/verify-built-package-invariants.mjs`（companion 缺席过渡）、`scripts/type-equiv.manifest.json`（daypaw-engine 文档配对）、`scripts/rescope-vendor.ts`（inspector wire-id skips）——以及再生的目录产物（`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`、`packages/extensions/tool-cordis/src/api-catalog.ts`、`docs/capability-seams*`、`docs/config-catalog*`、`docs/rescope*`、`docs/subsystems/README*`）。

## Alternatives considered

- **本次把所有未列 diff 一并立行。** 否决：这些编辑分属其他票的改动族，每行的原因列必须承载该族的裁决理由；本登记簿记录路径时效，而非全部未列 diff。改为上报、留待后续票登记。
- **把再生目录产物算作登记触碰。** 否决：它们是 sync 时再推导的生成器产物，而登记行登记手工编辑、不登记派生产物（目录重生卫生提交 `72002c1945` 即先例）。

## Consequences

- 登记簿全部路径在工作树中可解析、受触行的连带集与树一致，下一次 sync 即对每行按现存路径重放。
- 未登记的根脚本改动待后续票登记。无登记行时，sync 会以合并冲突或测试红暴露这些文件；仅注释的适应性修改静默，只在登记后才由登记行覆盖。
