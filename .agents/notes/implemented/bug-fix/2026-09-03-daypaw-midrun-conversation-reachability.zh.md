# Agent Note: daypaw 收件箱任务运行中对话可达性

Status: implemented

[English](2026-09-03-daypaw-midrun-conversation-reachability.md) | 中文

## 问题

#94 走查报告：任务运行中任务行打不开对话流，归因于 sessions 列表供给滞后。真网关复现（组装态浏览器客户端接真实 `dev:daypaw` 服务器与真实模型轮次，扩展 [#75 wire-contract 车道](2026-08-31-daypaw-start-run-args-envelope.zh.md)）给出不同归因：wire 供给健康——孪生会话在 `durable/startRun` 后约半秒入列（`api-session/added`，随后 `running:true`），运行中点行即可重入对话。两个真实断点对应验收缺口。其一，追问席位是硬编码的禁用占位（「追问即将上线」），运行中 steering 并不存在。其二，run 终态时 SDK body 的 agent-handle dispose 会发出孪生的 `api-session/removed`；客户端应用该移除后没有任何重拉，持久化的孪生保持未列，已完成行降级为裸 run 链接——只有冻结的舞台会话还显示历史，刷新页面才是意外的恢复路径。

## 决策

修复落在三个缝上。引擎新增 `durable/steerText` Remote：先解析 run 的定义并经其 wire face 校验自由文本再落段——与 `durable/startRun` 同规的起始文本规则，浏览器追问席位发送与弹窗相同的裸文本，消费侧 body 的 `def.input.parse` 复检通过；裸 `durable/steer` Remote 保持按原样落账，因为进程内 SDK 调用者传入已校验的值，且跨进程追问会在定义注册前落段。追问席位转正：ui-inbox 把账面 run 状态（板存储上 sessionId ≡ runId）作为席位的 owner props 传入，run 未完时席位启用，提交调 `durable/steerText`，成功清空草稿，wire 或契约拒绝显示内联失败。客户端 SessionManager 对 removal 帧先立即应用，再做一次对账 `session.list` 重拉：活 Session 的 dispose 不是 durable 删除，仍持久化的孪生重新入列，真正删除的 Session 保持缺席。对账窗口还暴露了一个真机运行才抓得到的 strict-slot 隐患：对话子槽是 session-maybe 父槽下的 strict-session 席位，选中任务的会话 binding 被掩蔽期间，WorkspaceSwitch 现在渲染占位而非 strict 槽——无 scope binding 的 outlet 会让席位崩到重挂载为止。

## 备选方案

**以会话的 agent running 位门控追问席位。** 否决：停在段边界的 steerable run 在账面读 `running` 而 agent 在回合间空闲，会话位恰在追问最要紧的时刻禁用席位；账面 run 行才是门。

**追问走排队 session prompt（`sendNote`）。** 否决：引擎 body 停在 `ctx.awaitSteer`，排队的 session prompt 唤不醒它——durable steer 段是 body 唯一消费的通道。

**给裸 `durable/steer` Remote 加 wire face 校验。** 否决：该 Remote 同时服务进程内 SDK 调用者（输入已过契约校验），且无定义注册时落段的跨进程追问必须照常落账（消费侧跨写者防线负责）；专用自由文本端点把两份契约分开。

**让 host 对持久化 Session 不发 `api-session/removed`。** 否决：活 Session 的 dispose 是正确的 host 语义，且那里不能同步知道持久化状态；客户端列表是「一次拉取加活帧」的投影，收敛属于拉取侧。

**看板投影无条件给 agent run 行挂会话链接。** 否决：`sessions.open` 对未列 id loud fail，行必须反映列表事实而非掩盖缺口。

## 后果

json 类定义在边界拒绝自由文本追问；席位显示内联失败，而不是 run 在消费侧校验时失败。每个 `api-session/removed` 帧现在多付一次单飞列表重拉，移除与复活之间有一个短暂的行闪断。终态后已完成行无需重连即可从持久化孪生重开对话。真网关 harness（cookie 鉴权的 `/api` HTTP 加 `ws` 包承载的 `/api/remote.mux` WebSocket，经 `__DSH_TRANSPORT__` 注入组装态 jsdom 启动）仍是唯一用真实客户端打真网关加真实模型轮的车道；它是临时工作流而非入库车道，因为它需要运行中的服务器与 API key。
