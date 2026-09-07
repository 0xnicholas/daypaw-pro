# Agent Note: ui-attachment 与 ui-reference 收入 daypaw web roster

Status: implemented

[English](2026-09-07-daypaw-attachment-reference-roster.md) | 中文

## Problem

可挂面清单盘点（wayfinder [#97](https://github.com/0xnicholas/daypaw-pro/issues/97)，`docs/research/2026-09-02-dsh-surface-catalog.md` §1，分支 `research/dsh-surface-catalog`）查出 fork web roster 恰缺两行上游 client 行，各只花一行 roster、零 fork 代码：`ui-attachment`——附件在会话槽上的全部表现面（composer 待发图列、拖放邀请、Chat/Trajectory/Tool 结果里的持久图、原图 lightbox）；`ui-reference`——composer 的 `@file`/`@session` 候选列表，其宿主服务行 `file-reference-local` 与 `session-reference` fork bundle 早已挂载。[ADR 0013](../../../../docs/adr/0013-positioning-review-dual-mode.md) 裁两行都收（wayfinder [#100](https://github.com/0xnicholas/daypaw-pro/issues/100) 裁决②）：贴截图是业务用户的自然需求且近乎白赚；`@` 引用只要有 composer 渲染触发机制，power 用户即刻受益。

## Decision

`packages/daypaw/web-app/cordis.patch.yml` 两行均收且启用：`ui-attachment` 置于 `ui-chat` 旁，紧邻其槽主 `ui-conversation`、`ui-chat`、`ui-tool` 与 `ui-trajectory`；`ui-reference` 置于 `ui-subagent` 后，镜像上游位次。两包入 bundle manifest 闭包使 `verify-cordis-config` 可解析，input-trigger 的 roster 注释随之改列全部三个引用源（`ui-skill`、`ui-subagent`、`ui-reference`）。收行决策由组合 roster spec 钉住（`packages/daypaw/web-app/tests/roster-coexistence.spec.ts`，行映射助手与 turn-outline 的 describe 共用）；激活由 assembled 车道钉住（`pnpm run test:web:daypaw`）：真实 bundle 的两个 client 半边在 fork 图中引导，且已提交的 goldens 不变——因为今天没有 fork 表面渲染这两个插件占据的槽：fork 的 ConversationView 与输入座遮蔽上游 composer 与聊天视图。这与 [turn-outline 收行决策](2026-09-06-daypaw-turn-outline-roster.zh.md)同构：能力先行上网，第一个渲染它的表面（排队中的候选是 #102 轻对话入口）无需改 roster 即可绑定。

## Alternatives considered

**像 `ui-schedule` 那样挂账禁用** — 否决：`ui-schedule` 等的是走查裁决；这两行是纯表现行、全部依赖已挂，挂账只会在每次 sync 后重裁同一行收不收。

**fork 或重包任一包** — 否决：票面边界是「无 fork 代码」；附件表现面不含需翻译的术语，`ui-reference` 的区块标签上游本就 locale 注册，#40 词汇映射在此无事可做。

**等轻对话表面（#102）一起挂** — 否决：roster 组合与表面渲染是两条缝；先收行使 #102 保持纯表面改动，且 assembled 车道即刻证明 fork 图已携带两个半边。

## Consequences

代价：boot 图多两个 client bundle；两行 roster 的可见收益要等一个 fork 尚未渲染的 composer 表面。换来：任何渲染上游会话槽（composer 图列、消息图、trajectory/工具图廊）或 `@` 触发机制的表面，无需再动组合即得完整附件表现与文件/会话候选；两包的上游修复（alpha.5 附件卡窗口显示它们仍在活跃维护）随 sync 白拿。spec 05 §4 的簇计数不动：它钉住的是已关闭的 #36/#37 复用边界裁决，本决策出自其后的 ADR 0013；`ui-attachment` 本就在整包复用簇，`ui-reference` 作为 #37 之后的行入册，其记录即本 note。
