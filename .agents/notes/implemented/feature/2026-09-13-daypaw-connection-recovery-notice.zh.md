# Agent Note: 连接恢复指示器进入 daypaw 壳

Status: implemented

[English](2026-09-13-daypaw-connection-recovery-notice.md) | 中文

## Problem

上游把浏览器 wire 的恢复循环硬化了（`ccfbbb443a`：集中式 websocket 恢复与 `ConnectionStateSource`/`ConnectionLoop` 出口面），随后在壳里露出（`19b4d7f26c` + `84c7ae3398`：dsh 设置触发器旁的连接指示器）。Wayfinder [#85](https://github.com/0xnicholas/daypaw-pro/issues/85) 裁决③裁定 fork 以业务语言移植接入（[#93](https://github.com/0xnicholas/daypaw-pro/issues/93)）：fork 重画的设置单面页（#59）没有等价面，恢复硬化之后可见的「正在重连」对业务用户有真实价值。票面把放置面（设置页 / 对话流顶部）留给实施时定。

## Decision

**放置面：工作区栏顶，所有选中面的上方**（`@daypaw/ui-inbox` 的 `WorkspaceSwitch`）。两个候选放置面都被栏顶支配：指示器在对话流、设置页、分组列表、Agents 目录上同样可见——断线时用户站在哪里都能看见。`WorkspaceSwitch` 本就是全部五种选中项的 fork 自有容器，chrome 落在一个属主手里，没有新缝。

**移植复用上游药丸：** `ConnectionNotice`（`packages/daypaw/ui-inbox/src/client/ConnectionNotice.tsx`）包住复用的 `ui-primitives` `ConnectionIndicator`，只自持状态推导——断线/重连药丸、点击重连命令、链路从断线恢复后保持两秒的「连接已恢复」确认（首连从不显示）。文案是 `inbox` locale 词典里的 daypaw 业务语言（网络连接已断开 / 立即重连 / 正在重连 / 连接已恢复，加两条 aria 标签），药丸因此与所有复用原语一样跟随品牌 token。壳对 wire 内核的消费恰好走其硬化出口面：`WorkspaceSwitchInjected` 增 `hooks.connectionState`（绑定为 `useConnectionState`，即 `ConnectionStateSource` observable）与 `reconnect`（`ConnectionHandle` 命令）；`apply` 原样注入 `connection.state` 与 `connection.reconnect()`——包内不存在 wire 状态的第二份镜像。

## Consequences

对话中的业务用户现在用产品词汇看到传输健康，而不是无声停顿。`startChat` 分发器的仅告警失败策略（其 README 注释已预告「the connection indicator already owns transport health」）等到了它指涉的面。

组装 golden（`apps/daypaw-web/tests/connection-recovery.golden.ts`）经 fixture 传输上的真实 `ConnectionController` 覆盖离线事件 → 断线药丸 → 药丸点击 → 恢复确认 → 回落的完整回路。它同时也是启动断言的执行者：`@daypaw/web-app` 的 roster 必须满足上游 `11d6bd05f3` 引入的服务约束——`ui-chat`/`ui-skill`/`ui-reference` 硬等待 `sidebarRight` 服务，`api-workspace-files` 硬等待 `resources`。镜像层携带 `resources` + `ui-sidebar-right` 两行（后者作服务宿主与 `'rightbar.session'` 声明者；fork 的 `TaskDetail` 以 -1 优先级遮蔽其 occupant，沿用既定的遮而不删模式；文档/文件 tab 两行仍是 fork 有意裁剪）。其二，ui-inbox 两处遮蔽席的注册是只等 `layout` 服务的直接 `slots.register`，而 `'main.conversation'`/`'rightbar.session'` 由 ui-conversation/ui-sidebar-right 声明，其 fiber 激活与该门无序——注册经 `slots.inject()` 依赖各自座位，由座位自己的 provider 解析。`'sidebar'` 席保持直接注册（ui-layout 在提供 `layout` 的同一 effect 里声明它，缺席时失败保持大声）。两项修复登记于 [docs/fork/CORE_TOUCHES.md](../../../../docs/fork/CORE_TOUCHES.md)；`task-progress` golden 的过期 `detailsCol` class 查找随上游改名滚到 `rightbarCol`，预期输出逐字节不变。

## Alternatives considered

**放在设置页上**：否决——设置页恰在用户配置时才打开，而不是对话停摆时；指示器的价值峰值在对话流里，栏顶两者兼收。

**fork 自绘画丸**：否决——`ui-primitives` 的 `ConnectionIndicator` 是纯表现（标签走 props）、已随 sync 在树、token 驱动；自持第二份药丸实现为零产品词汇收益复制了复用内核面（业务语言的部分是文案，不是像素）。

**包内连接状态镜像（一个转发 `connection.state` 的 store）**：否决——硬化出口面本身就是 observable；复制它只会在 renderer 边界后多出一份传输事实源，无消费者收益。

**roster 缺口单独立票而本票不修**：否决——golden 车道是本改动的钉验面，被服务的产品同样过不了 boot 断言；两行是机械的组合镜像（上游 web bundle 自带两行），不是产品接面决策，随本票的启用性修复落地并单列 CORE_TOUCHES 登记。
