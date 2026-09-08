# Agent Note: trajectory 检查器 tab 落地单壳分层

Status: implemented

[English](2026-09-08-daypaw-trajectory-inspector-tab.md) | 中文

## 问题

裁决 [#100](https://github.com/0xnicholas/daypaw-pro/issues/100) 之③把双模式 IA 定为单壳分层：无全局开关、专业面按需展开，trajectory 事件账本作为检查器 tab 拿到中栏第一席（spec 05 §3，#101 修订）。fork 名册自脚手架起就挂着 `ui-trajectory`，但其注册目标 `conversation.view` 只被上游 ConversationRoot 渲染——在 daypaw 壳里那是被遮蔽的休眠壳件，账本挂而不显。要在 fork 对话座里露出它，撞上两堵墙：slot 系统的 one-declarer-per-slot 规则（entry 只能渲染自己注册声明的子槽，`conversation.view` 归 ui-conversation 的休眠壳件所有）与 client 栈规则（功能插件之间禁止运行时取值、禁止为解锁加导出；UI 只经 slot 跨包）。此外浏览器插件根本没有 config 通道：`dsh.client` 行的 cordis.yml config 在 boot wire 上被静默丢弃。

## 决策

缝是「上游 config 通道 + 重定向」，两者默认不变：

- **行 config 通道**（`packages/client/modules` + `packages/client/web`）：`WebBootEntry`/`BootPluginRow` 增可选 `config` 字段。包在清单里以 `dsh.client.config: true` 显式声明消费——只有声明了的行，宿主半侧才把 loader 行的 cordis config 随 boot wire 下发，下发前校验 JSON 可序列化（函数/符号/undefined/bigint/非有限数/Map 等非普通对象组合期大声拒绝；wire 是 JSON 全局）。web boot 内核把它传给 `loader.create({ name, config })`，cordis 照常用插件的 `Config` schema 校验后交给 `apply`。声明制让持有仅宿主可用的 `!!js` config 的双面行（fork 的 `connection` 行读 `ctx.webRuntime`）与此前逐字节一致地留在宿主侧。
- **重定向**（`packages/client/ui-trajectory`）：客户端入口导出 `Config`（`viewSlot`，默认 `'conversation.view'`）并声明 config 消费；`apply` 把账本 tab 注册进配置的环。
- **fork 席位**（`@daypaw/ui-tasks`）：对话座注册声明会话作用域 list 槽 `inbox.workspace.conversation.inspector`（owner = ui-conversation 的 `ConvViewOwnerProps`，仅类型导入），ConversationView 渲染两 tab 条——默认不变的「对话」业务面与按需展开、渲染该环的「检查器」面。重定向后的账本经普通 slot API 注册进去；无跨包取值、无重复声明。环的 owner 面传 `viewRequest: null` 加真实的 `openView`（指向环的请求会翻开检查器面）与 no-op 的 `completeViewRequest`：fork 席位目前不发起任何 focus 请求。审批卡与追问席在两面均保持挂载；会话切换重置回业务面（面状态按会话身份派生，无 effect）。

fork 的 `cordis.patch.yml` 把 ui-trajectory 行的 `viewSlot` 指到检查器环键。

## 后果

中栏从此原样携带专业层：上游的轮次感知账本、时序概览与逐记录 inspector 在席位内渲染，零重写，上游 trajectory 的后续改进随名册行白拿。行 config 通道是通用浏览器能力：任何 client 插件声明消费即可收到所属行的 cordis.yml config，收掉「浏览器 `Config` schema 从不生效」的上游潜在缺口（ui-conversation 的 `maxConcurrentFileUploads` 是既存的休眠例——上游仍休眠，因为没有上游 web 行设 config）。三条 CORE_TOUCHES 行登记上游文件，均为上游 PR 候选。测试：modules/web 的通道测试（宿主转发、JSON 拒绝、未声明行排除、wire 解析、boot apply 收货）、ui-trajectory 的 src 级重定向 spec、ui-tasks 的 tab 条单元覆盖、roster 共存钉、以及装配 golden（`trajectory-inspector.golden.ts`）端到端证明构建产物车道——fixture 回声下账本的 USER/ASSISTANT 行渲染、业务面让位、聊天席保持激活。

## 考虑过的替代

**fork 侧重注册上游组件**（require trajectory bundle、把其视图重注册进 fork 环）：死于 bundle 纯度门——禁用行不进模块表（require 抛错），启用行自己的注册已声明 `conversation.trajectory.images` 子槽，第二次注册撞 one-declarer 冲突。

**`mountTrajectoryView(ctx, slot)` 导出**由 fork 宿主消费：违反 client 导出纪律（禁止为解锁加值导出）与禁运行时导入规则；无 owner 签署即弃。

**slot 共声明**（上游 ui-slots 允许相同 spec 的第二声明者共享渲染权）：fork diff 最小，但要重写 slot 核心的装载期不变量、文档与测试；为 fork 局部需求付出最大的上游仲裁成本。

**fork 自研紧凑检查器**（消费 `useTrajectory` 标准钩子）：零上游改动，但重写的恰是 #100 裁决原样露出的层，且上游账本每个改进都变成手工同步。
