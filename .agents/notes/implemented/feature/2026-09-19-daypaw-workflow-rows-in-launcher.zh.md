# Agent Note：workflow 定义进发起面名册

Status: implemented

[English](2026-09-19-daypaw-workflow-rows-in-launcher.md) | 中文

## Problem

引擎注册两个定义家族，除发起面外两者处处同一等：`durable/listDefinitions` 同时返回 agent 与 workflow，`durable/startRun` 两者都收，看板与详情列本就渲染 workflow run。名册收窄成 `kind === 'agent'` 会让工作区 `daypaw/agents/*.mjs` 里的 workflow 定义没有产品入口，workflow 负载因此完全起不来（[ticket #127](https://github.com/0xnicholas/daypaw-pro/issues/127)）。

裁决 #65 第 6 条把名册定在注册表本身。挡住 workflow 行的不是名册而是提交序列：它铸造 run id、调 `durable/startRun`，再等该 run 的 session 孪生进 sessions 列表，因为 agent run 的会话身份即其 runId，而 `sessions.open` 拒收未列出的 id。workflow run 没有会话（ADR 0016），所以这个等待会走到边界，为一个引擎其实已正确启动的 run 报通用失败。

定义不带 wire 面时 `inputKind` 为 `null`，而每个 workflow 定义都如此：只有 agent 编译路径会挂 wire 面。渲染器与 `composeInput` 对 `null` 的读法不同——`?? 'text'` 回落渲染自由文本框，而发送侧把草稿当 JSON——于是 workflow 行的两侧对输入面各执一词。

## Decision

- **发起面名册承载注册表持有的全部定义。** `DefinitionOption` 携带定义的 `kind`，选择器列出每一行且不检查它。agent 行保留 display 声明的业务名；workflow 定义不声明 display，显示技术名。
- **输入种为 null 的定义在渲染与发送两侧共用 JSON 面。** 渲染器把「未选中行」与「选中行的输入种为 `null`」分开，后者渲染 JSON 框，与 `composeInput` 发送的一致：引擎原样插入该值，定义自己的 input 契约在起跑时校验它。
- **提交回报「开什么」，由定义 kind 决定。** `NewTaskOutcome` 要么是刚建 agent run 的会话（等过孪生），要么是刚建 workflow run 的 id（本就没有孪生可等）。弹窗把 agent 结果交给 `openTask`、workflow 结果交给 `openRun`。
- **两个 opening 都归收件箱。** `InboxNewTaskDialogOwnerProps` 与 `openTask` 并排携带 `openRun`，三个效果相同：踢一记看板刷新、关闭弹窗、选中刚建之物——无会话 run 选 `{ kind: 'run' }`，选择模型与详情列都渲染它。
- **选择器文案报的是任务类型而非 agent。** 选择器、空态、JSON 提示与加载失败行在两本词典里都读中性的任务类型措辞，键为类型化键 `dialog.type.*`。
- **Agents 目录只列 agent。** 目录页显示 agent 目录，发起面起两个家族中的任一个。两者读同一个 `listDefinitions` 视图，这处分家写在 spec 05 §5 里，而不是靠共享投影隐式兜着。

## Alternatives considered

**名册保持只列 agent，首个 workflow 负载另找起跑路径**——脚本、boot 期 starter，或一个认 workflow 的 e2e harness。否决：该负载要产出的正是真组合上的运行认知，而自造起跑器在 `dsh` profile 启动规则之外添一件产品形状的产物，且往后每个 workflow 负载仍然无路；它也与过滤自称实现的裁决 #65 第 6 条相悖。

**给 workflow 定义单开一个入口面**（第二个选择器或看板动作）。否决：那会把 #60 与 #65 拆掉的第二名册请回来，并且要重复弹窗已持有的输入面、铸造 run id 的重试与内联失败处理。

**留着 `?? 'text'` 回落，对无 wire 面的定义为文本草稿**。否决：它把 JSON 形状的任务静默当字符串发出去，引擎的 input 契约随后拒掉一个弹窗本可做语法校验的值。渲染器与发送侧必须同一条规则。

**在本次给 `defineWorkflow` 加 `display`。** 否决属范围外：workflow 目录视图还没有消费者，而对一个什么都没声明的定义，技术名是诚实的。它留住为一个具名缺口，而不是一个猜来的标题。

## Consequences

- 工作区名册里的 workflow 定义起跑方式与 agent 定义相同——铸造 run id、内联失败、看板刷新——建好的 run 以 run 自身为选中态打开。
- 引擎的 HITL gate 仍无产品面作答入口。`resolveGate` 是 host 方法而非 `@Remote` 端点，所以真 workflow 的 `ctx.waitFor` 只有在 host 代码结算时才不走超时分支。首个真负载把它记为发现，而不是本次改动的缺陷。
- 新任务弹窗文案有变化；组件金样承载新措辞，locale 键集随键名迁移而移动。
- 覆盖率：store 用例断言名册承载全部定义、workflow 提交不等 session 孪生即落定；弹窗用例断言 workflow 行的 JSON 面与 `openRun` 交接；导航用例的 owner 契约断言两个 opening。
