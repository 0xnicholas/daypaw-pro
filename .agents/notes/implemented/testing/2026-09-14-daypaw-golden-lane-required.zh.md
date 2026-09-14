# Agent Note: daypaw 组装 golden 车道挂进 fork main CI 必需门

Status: implemented

[English](2026-09-14-daypaw-golden-lane-required.md) | 中文

## Problem

没有任何 CI 车道跑 daypaw 组装 golden 车道（`vitest.web.daypaw.config.ts`，`apps/daypaw-web/tests/**/*.golden.ts`）：必需的 `ci-daypaw-hosted` 聚合载的是上游确定性 gate，advisory 作业跑三条时敏全量道（[车道拆分](2026-08-30-coverage-gate-main-ci-lane.zh.md)）。2026-10-09 上游 sync 漏收 `resources` 与 `ui-sidebar-right` 两 roster 供主行——上游 `11d6bd05f3` 起保留行硬等待 `sidebarRight`/`resources`——daypaw 浏览器 boot 在 HEAD 上已断：产品壳与全部组装 golden 红了整个 sync 周期，直到 [#93](https://github.com/0xnicholas/daypaw-pro/issues/93) 补 golden 才撞上（roster 修复已登记 core touch；见[连接恢复 note](../feature/2026-09-13-daypaw-connection-recovery-notice.zh.md)）。修复收掉了这一例；检测缺口仍在——未来 sync 再漏一行保留行所注入的 roster，CI 依旧什么都不红。

## Decision

- 车道以 `daypaw-web-goldens` gate 挂进必需的 `ci-daypaw-hosted` 聚合：`pnpm run test:web:daypaw:built`、`needs: ['build']`——golden 读的是聚合 build gate 产出的 `lib/client.js` 构建束。工作流无需加步：聚合自带该 gate；其头注的 gate 枚举记录了此次增补。上游 `ci-primary` 聚合不动。
- 按车道拆分规则做时序归属：组装 golden 是真实构建 roster 在 jsdom 里对免 key fixture transport 的 boot——免 key、对已提交金样的确定性比对——不是测宿主的时敏测量，故设门而非 advisory。默认运行（不设 `DSH_SNAPSHOT`）即比对判定；record/refresh 仍是显式本地工作流。判定面已验证：撤掉 `resources` roster 行，8 个 golden 文件全红；恢复后车道全绿（8 文件 / 9 用例，串行，8 核开发机约 40–50 秒）。

## Alternatives considered

**把车道放进 advisory 时敏作业。** 否决：advisory 车道只报告不设门，sync 漏帐类失败将保持非阻塞；且车道本身确定——错误归类等于背离证据重开确定性拆分之争。

**在工作流加步而非进聚合。** 否决：作业的门住在聚合里，聚合已拥有该 gate 所需的 build 依赖；平行的 YAML 步会让判定面分裂到 `run-gates.ts` 与工作流两处，无复用可得。

**用 `test:web:daypaw`（含 build）设门。** 否决：聚合已把 `build` 作为带 needs 图的 gate 运行；`:built` 变体才是判定面，与 `ci-linux-primary` 的 web-snapshot gate 用 `test:web:built` 同一先例。

## Consequences

- main 推送对组装 golden 设门：sync 再漏一行保留行硬等待的 roster，必需作业在该 gate 变红（见上方撤行验证），而不是无声放行断掉的产品壳。
- 必需作业墙钟增长该车道的串行时长（hosted 4-vCPU 预计约 1–2 分钟）；90 分钟作业预算足以吸收。
- 车道若在 hosted 硬件上确证边缘，适用车道拆分规则——移入 advisory 作业而非放宽预算；本决策不把它钉成不可动。
- [2026-08-30 车道 note](2026-08-30-coverage-gate-main-ci-lane.zh.md) 的聚合枚举与 `docs/fork/CORE_TOUCHES.md` 的 `scripts/run-gates.ts` 行在同一变更中随动。
