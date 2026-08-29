# Agent Note: 覆盖率门修复与 fork 自有 main CI 车道

Status: implemented

[English](2026-08-30-coverage-gate-main-ci-lane.md) | 中文

## Problem

per-file 100% 覆盖率门从未在本 fork 的 CI 上跑过:继承的 `CI` 工作流 `pull_request` 作业解析到上游 org 的 runner 标签(`dsh-ubuntu-24-04-16core`),本 fork 不存在——dependabot run 排队数小时直至超时;`CI master` 只监听上游默认分支 `master`,永不触发本 fork 的 `main`。本地跑门则红在三处:`daypaw/ui-tasks/src/client/task-list.tsx`(branch 96.15%)、`daypaw/ui-inbox/src/client/index.ts`(lines 97.87%)、`daypaw/engine/src/core.ts`(branch 99.57%,`settledResult` 的 failed 行路径)。

## Decision

- ADR 0007 §1 按裁决落地:`vitest.config.ts` coverage exclude 增一条 glob `packages/daypaw/ui-*/src/**`(登记于 `docs/fork/CORE_TOUCHES.md` 的 core touch),镜像上游对 client UI 的 GUI 债豁免——jsdom 组件测试与组装 web 车道保留,per-file 门不适用;daypaw 的 host 侧包仍走门。
- engine 的缺口补测而非豁免:crafted-row 测试新增对 `error_json` 非空的 `failed` 行的 attach,走 `settledResult` 的 `JSON.parse` 方向(此前唯一一次过该分支的输入 `error_json: null`;真实失败经 runner 结算,永不走 attach 重放)。`engine/src/core.ts` per-file 100%。
- main 推送经新 fork 自有工作流 `.github/workflows/ci-daypaw-main.yml` 获得穷尽 CI:单 `ubuntu-latest` 作业(公开仓库——hosted 分钟免费)跑 `pnpm run check:ci:linux-primary`,即上游 master standby 同款串行聚合(typecheck、lint、duplication、per-file 覆盖率、快照、doc-sync、module graph、knip、build、publint、node-next types、built invariants、bin smoke、web snapshot),带 `DSH_TELEMETRY_DISABLED` 与按 ref 取消。
- 车道把六个 gate 并发环境变量钉为 `1`(上游 master standby 的串行形态):该聚合在 4-vCPU hosted runner 上的首跑因资源竞争超时失败,同一次运行还暴露了死车道放过的真违规——`agents-dir.ts` 的动态工厂导入赋值 `any`(`no-unsafe-assignment`);导入现按文件边界结构化类型。
- 死掉的继承 `CI` 工作流经 GitHub UI 禁用(可逆、零 core touch——ADR 0007 §5 先例),卡死的排队 run 已取消。`CI master` 不动:本 fork 永不推送它监听的分支,无法触发。

## Alternatives considered

**把 `ci-master.yml` 改指 `main`。** 否决:其作业假设自有 self-hosted standby 池与 Wine 缓存播种;无这些 runner 车道会永远排队,且改动是对上游文件的宽面 core touch。

**给继承 `ci.yml` 加 `push: main`。** 否决:每个作业都以 `github.event_name == 'pull_request'` 为条件并读 PR 上下文(base sha、user login),只加触发器什么都跑不起来;适配条件比 fork 自有文件付出的 core touch 更大。

**补齐 ui-* 缺口而非落 glob。** 否决:ADR 0007 §1 已按上游自身先例裁决家族姿态;在 jsdom 宿主上追组件的 per-file 100% 买不到组装车道没有的验证。

## Consequences

- 三处门失败消除:`engine/src/core.ts` 量得 100%,两个 `ui-*` 文件被豁免,scoped 覆盖率跑不再触发阈值。
- 本机全量 `pnpm run test:coverage` 仍会在文档化的 Node 26 flake 集上中断(10 个文件 12 失败;11 个文件中 10 个隔离跑通过,`session-projection-cache` 隔离跑红与 sync 笔记基线记录一致)。权威门判定属于新的 node-24 CI 车道;本地 flake 红是基线,不是回归。
- 未来的 daypaw `ui-*` 包自动落入 glob;host 侧 daypaw 包若未达标,main 车道会响亮失败。
