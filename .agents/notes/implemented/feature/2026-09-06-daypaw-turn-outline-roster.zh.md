# Agent Note: session-turn-outline 进入 daypaw web roster

Status: implemented

[English](2026-09-06-daypaw-turn-outline-roster.md) | 中文

## 问题

上游 `7e2eacb1fe`（随 2026-09-06 sync 至 `d347e70390` 载入）新增 `packages/session/session-turn-outline`：全日志 `turnOutline` 投影单元，为每个已开始的 turn 提供其 `turn/start` seq 与有界的 prompt/response 预览，上游 web bundle 默认启用。fork 的 `@daypaw/web-app` roster 镜像层须裁接不接（wayfinder #85 裁决②），而 fork 已从另一条缝供长会话导航事实——durable 引擎的 `durable/journalTimeline` Remote 供任务详情页右栏——因此两个读模型须以执行证据证明共存，而非默认无冲突。

## 裁决

roster 收 `session-turn-outline` 启用行，镜像上游紧邻 `session-stats` 的位置；并镜像上游 `ui-schedule` 行的出厂 `disabled: true` 态（wayfinder #85 裁决④，裁决①挂账的机械后果）。两行同步进 `packages/daypaw/web-app/package.json` 闭包 manifest，`verify-cordis-config` 可解析。共存由执行 spec 证明（`packages/daypaw/web-app/tests/roster-coexistence.spec.ts`）：roster 事实经真实 `dsh-app-boot` patch 分层组合；一棵宿主树——fork 的 `DurableEngine` 加 session store、投影注册表与 turn-outline 插件——同时从引擎缝应答 `durable/journalTimeline`、从 session 投影缝应答 `turnOutline`，键不同、无共享面。业务语言化（ticket #92 任务③，依 #40 词汇映射）刻意未做：今日无 fork 可见面渲染 turn-outline 节点——fork 的 ConversationView 遮蔽了持有 turn rail 的上游 ChatView——投影以数据形态先行，#40 映射约束未来第一个渲染条目的 fork 表面（fork 的 CONTEXT.md 已含 "turn/轮次" 引擎词）。

## 后果

daypaw 表面以零呈现成本向未来消费方供 outline 投影；漂移窗两行上游新行的收/不收裁决由执行测试钉住，而非仅靠 yaml。golden 车道不受影响：`session-turn-outline` 仅宿主侧（无 `dsh.client` 半面）、`ui-schedule` 禁用，组装 jsdom 图两者皆跳过。未来某 fork 表面开始渲染 outline 条目时，投影键已在 wire 上，座位决策（rail 位置、业务措辞）是产品表面变更，而非 roster 变更。

## 备选方案

**像 `ui-schedule` 一样挂账（wayfinder #85 裁决①）**：否——outline 是纯读模型，无交互面可走查，上游默认启用，收行仅花一行 roster；挂账只会在 schedule 走查后重演同一裁决。

**fork 或重包投影**：否——该单元是上游 session 域的纯 fold；roster 行加 base bundle 已挂的投影注册表即全部集成，包装层会复制缝已持有的 fold。

**现在就落 #40 词汇映射**：否，过早——无 fork 表面渲染条目，今日写下的映射只会约束一个不存在的表面；映射的家在第一个渲染表面（见裁决）。
