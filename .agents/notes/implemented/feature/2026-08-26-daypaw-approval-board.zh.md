# Agent Note: daypaw 审批待办板块（等待你确认分组、对话内即时卡、mux 重放）

Status: implemented

[English](2026-08-26-daypaw-approval-board.md) | 中文

## Problem

Issue #58（spec 05 §2/§3/§6，壳板块增量 ③）把审批待办从 [IA 骨架](2026-08-24-daypaw-shell-ia-skeleton.zh.md)的占位零分组变成壳的安全面：pending 审批须跨任务聚合进「等待你确认」分组并联动计数，选中任务的对话须置顶即时卡（「<任务名> 请你确认：<业务动作摘要>」+ 同意/拒绝，拒绝可附言回对话，原始命令收详情展开），冷启动须恢复待办。#44 裁决了 v1 后端面：只用 dsh 交互式审批面——apiproxy pending 聚合 + mux 重放——pending unary 查询不做，因此板块展示的每个事实都来自既有 wire。

## Decision

- **徽章即分诊，且只有 approval 徽章路由** —— `projectInboxBoard`（ui-inbox `task-projection.ts`）把任何行——run 支撑或无 run——只要 runtime 会话摘要带 `pendingInteraction: 'approval'` 就移入等待你确认，无视其状态分组，并打 `awaitingApproval` 标记让 TaskList 以等待确认文案盖过 run 状态。runtime 把一个会话的 pending 交互折叠为单一可操作状态且 question 优先于 approval，因此被 question 遮蔽的 approval 到不了这里；question 与 plan-review 徽章留在其状态分组，因为本板块是审批待办面，不是 ask-user 面。作答即清徽章（resolved 广播摘除等待），行回落其状态分组——板块联动这条 spec 线不需要引擎改动：「任务回到进行中」就是徽章离开。
- **冷启动即 mux-open 重放，不是查询** —— manager 为从未实例化的会话从 mux 帧跟踪 pending 交互徽章，每次 mux open 以稳定 rpcId 重放仍待处理的请求，分组计数因此在壳重开后存活，零新端点（#44 裁决）。fixture 常驻审批现在带 `callId` 并与 fx-alpha 日志新增的 turn-75 开放 tool/call 配对，使卡片的详情路径读真实的 `runningCalls` 窗口；常驻 question 迁至 fx-gamma——在 run 孪生会话上它会遮蔽 approval 徽章，分组永远填不上。开放 turn 的已完成 step 0 承载 fixture 的 todo_write 样本（被阻塞的 bash 调用是 step 1）：standing plan 在下一个 `turn/start` 退役，独立成完整 turn 再后缀开放 turn 会清空 dock 的计划条并连带失去上游 todo 面的覆盖——折叠后配对查找与 standing plan 同时存活。
- **卡片是 ConversationView 内部组件，架在 runtime 的 PendingWait 载体上** —— `ApprovalCard` 把会话 pending 列表收窄到 approval 等待，经 `wait.respond` 以域编码作答（`{ sessionId, approvalId, outcome: 'allowed-once' | 'rejected' }`）；清算是帧驱动的（resolved 广播摘除等待，父层停止渲染），按钮单发闭锁，仅在回执未被接受或附言发送失败时带错误行重新武装。工具名永不渲染（产品词汇规则）：标题拼接任务显示名与请求的 `reason`（缺席时用通用敏感操作文案），详情展开显示配对 call 的原始命令、或 pretty-print 的参数、或不可解析时的原文——操作者的核对通道。无 `callId` 的请求不渲染展开。
- **拒绝附言走普通 queue prompt** —— 注册侧的 `sendNote` inject 面解析会话绑定并以 `queue` 模式 prompt 修剪后的附言，运行中的任务把它当 steering 消费（#53 多段 run）、空闲任务开新回合；整个流程没有任何新 wire 面。

## Alternatives considered

- **pending unary 查询（按需拉取 pending 审批）** —— #44 否决：mux-open 重放就是冷启动基线；查询端点会复制重放已携带的事实。
- **以 run 的 `waiting` 状态做板块分诊** —— 否决：等待你确认是派生态 join（spec 05 §2），不是引擎状态；审批挂着时 run 仍是 `running`，无 run 会话根本没有 run 状态。徽章是 wire 提供的唯一跨会话聚合。
- **把 question/plan-review 徽章也路由进分组** —— 否决：分组的文案与计数承诺的是审批工作；question 行会困住用户在一张答不了的卡上（ask-user 面属于上游的 composer）。
- **为作答另造审批 RPC** —— 否决：`PendingWait.respond` 是 runtime 的应答载体且已编码 client-response 信封；第二条路径会分裂清算竞态（respond 先到先得，落败得 not-pending 回执）。
- **拒绝附言用 steering 模式发送** —— 否决：steer 模式对空闲会话失败（fixture 会降级为排队回合，但 wire 契约不承诺）；queue 模式对两种状态都有定义。

## Consequences

板块仅凭重放填充，两种作答都可观察闭环（卡片消失、徽章清除、行回落状态分组、拒绝附言落为对话行），整个面都跑在上游既有 wire 上——fork 的增量是投影规则、卡片、附言路径与 fixture/文案接线。代价：一处上游 fixture 改动及其 spec（CORE_TOUCHES 行）、fx-gamma 的 running 翻转改为显式开启（`FixtureOptions.flipGammaRunning`，环境翻转与任何把 sessions 列表采进 golden 的车道竞态）、task-progress 快照车道改经等待你确认分组进入 fx-alpha 对话（board golden 刷新为新启动看板）。[任务进度 note](2026-08-26-daypaw-task-progress.zh.md)的挂账项——占位零分组——在此了结；其 workflow-run 保留意见仍在（无 session 的 run 永远得不到徽章，workflow run 的审批在 run 作用域审批通道存在之前不上面板）。

## Testing

ui-inbox spec 钉投影分诊（两种行型的 approval 徽章路由、question/plan-review 排除、徽章清除回落）；ui-tasks spec 钉卡片（标题拼接、工具名缺席、展开变体、单发闭锁与重新武装、两步拒绝与附言顺序）及 `sendNote` queue 路径含两个失败臂；connection fixture spec 钉重放的 approval/question 归属与显式翻转；`apps/daypaw-web/tests/task-approval.snapshot.ts` 免密钥钉组装闭环——冷启动重放（未打开任何会话时的分组计数 + 行 + 状态文案）、卡片、同意闭环、拒绝附言闭环回落对话。

## Deferred

`ctx.waitFor` gate 的 run 尚不产生徽章（引擎原语 #47 已落地但没有 host 桥，wire 上没有任何 run 携带 gate-pending 审批）；workflow run 的审批需要 run 作用域审批通道；审批策略可调性留在 v1 外（spec 05 §6 固定保守默认）。
