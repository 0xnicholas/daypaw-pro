# Agent Note: daypaw agent 目录页

Status: implemented

[English](2026-08-25-daypaw-agent-catalog.md) | 中文

## Problem

Issue #60（spec 05 §3/§5，壳板块增量 ④b）要求壳的 Agents 视图成为真正的目录：网格枚举引擎注册的 agent 定义（带标题与描述），详情页以 `name@version` 为标识。壳侧已有 inbox 工作区与槽位图（#58）；引擎侧已有读视图（#51 `listDefinitions`）但没有东西把它送过 wire——`ctx.durable` 是 host 侧服务，web 客户端只能走 gateway 的 Typert Remote 通道。

## Decision

- **经 Typert Remote 通道暴露 `listDefinitions`** —— `DurableService` 增加 `@Remote('listDefinitions')` 声明，gateway 在运行时认领 `durable/listDefinitions` 端点，沿用 GoalService 先例。根 `tsdown.config.ts` 的 typertPlugin 在 `build:lib:host` 生成 host/remote-client 描述符；零上游 apiproxy 改动。fixture（`packages/client/connection`）以两个罐头定义应答同一端点，各客户端通道保持免密钥。
- **目录读定义，不读 preset** —— 定义带 `name@version`（票据的详情标识）与可选展示元数据；preset 既无 version 也无稳定名册标识。新任务弹窗（#56）因此保持 preset 名册，目录页消费引擎注册表。双名册记为 Known Limitation：弹窗提供 preset，目录展示定义，只有当 preset 与定义成对登记时两者才对齐。
- **新包 `@daypaw/ui-agents` 占据 ui-inbox 新槽 `inbox.agents.page`** —— `scope: 'session-maybe'`（浏览目录不需要 session；发起运行走既有 sessions.create 路径）。上游 ui-agent-preset 行不动：它占据另一个槽、服务另一个面。该包把 `DefinitionView` 投影为卡片模型（`title = display?.title ?? name`、agent-kind 过滤、`name@version` 键），在 wire 边界校验载荷，在 inbox WorkspaceSwitch fallback 之后渲染网格与详情视图。
- **快照通道钉住产物** —— `apps/daypaw-web/tests/agents-catalog.snapshot.ts` 对 fixture 名册录制网格与详情 golden，免密钥。

## Alternatives considered

- **目录读 `agentPresets`** —— 否决：preset 无 version，详情页无法兑现票据的 `name@version` 标识，且 preset 元数据是部署配置而非引擎事实。
- **gateway 旁加 HTTP/REST 端点** —— 否决：客户端已讲 Typert Remote；为一个方法开第二条通道会重复 auth、类型与 codegen 设施。
- **页面折进 ui-inbox** —— 否决：inbox 包拥有工作区骨架；目录是自带 locales、store 与测试的独立面，槽位图正是为此存在。
- **扩展 ui-agent-preset 而非新包** —— 否决：该包以 preset 名册为界；让它指向引擎注册表会同时模糊两个面及其既有快照。

## Consequences

壳的 Agents 视图渲染引擎活名册，`durable/listDefinitions` 的 wire 契约由 codegen 生成并被快照钉住。代价：一个新包及其根接线（tsconfig references、knip 条目、cordis.patch 名册、assembled-boot PLUGINS）、一处上游 fixture 改动（已登记 `docs/fork/CORE_TOUCHES.md`），以及引擎服务现在带 Typert Remote 声明，使 protocol 包成为 `@daypaw/engine` 的 peer。

## Testing

`packages/daypaw/ui-agents/tests/` 覆盖 wire 边界解析器（全部拒绝分支）、目录 store 投影（过滤、标题回退、generation 竞态、孤儿选中、未知键 open）、页面渲染与 locale 键对等；包 src 保持 per-file 100% 覆盖。`packages/daypaw/engine/tests/queries.spec.ts` 断言 `display` 未声明时该键缺席。`apps/daypaw-web/tests/agents-catalog.snapshot.ts` 经组装后的 web 应用录制网格与详情 golden。

## Deferred

弹窗 preset 名册与目录定义名册的对齐（如 preset 引用 `name@version`）是后续产品工作。详情页暂不提供发起运行入口；运行从新任务弹窗发起。
