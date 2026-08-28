# Agent Note: daypaw 壳 IA 骨架——ui-inbox 工作台三栏

Status: implemented

[English](2026-08-24-daypaw-shell-ia-skeleton.md) | 中文

## 问题

spec 第 5 章 §3 裁决了产品壳的 IA：三栏收件箱工作台（导航 / 工作区 / 详情），只用呈现层词汇。[产品壳脚手架](../architecture/2026-08-23-daypaw-product-shell-scaffold.zh.md)当初刻意把完整的上游浏览器 roster 保留为占位以便组合可启动；把这份 roster 变成 daypaw IA（issue #55）必须在不破坏休眠占位生态的前提下回答三个问题：当 ui-workspace 与 ui-settings-general 仍向 ui-sidebar 声明的席位注册时，fork 导航如何替换 ui-sidebar；ui-conversation 的中/右栏占据者是否也要一并移除；以及当三个栏目 slot 分属三个不同 scope（root / session-maybe / session）时，一份选中态如何共享。

## 决定

新的 client UI 插件包 `packages/daypaw/ui-inbox`（`@daypaw/ui-inbox`，private，0.0.0），包形对齐上游 `packages/client/ui-sidebar`，在一个 `apply` 里做三次注册：

- **`InboxNav` 进入 `'sidebar'`**（root scope）——ui-sidebar 的 roster 行从 `@daypaw/web-app` 的 `cordis.patch.yml` 中*移除*（连同 `package.json` 依赖），而非遮蔽：ui-sidebar 属 spec §4 的 wholesale 重写簇，且向其声明席位（`sidebar.workspaces`、`sidebar.settings`）注册的依赖方走 `ctx.slots.inject`，声明消失后它们静默 pending，无加载错误。导航渲染 wordmark、全宽主色「+ 新任务」大按钮（打开最小可关闭的对话框桩——开关态为组件局部，agent 选择内容归 agent 目录票）、带占位零计数位的三个分组「等待你确认/进行中/已完成」、以及 Agents/设置 次要导航；折叠时渲染契约要求的 56px 控制轨（侧栏开关 + 新任务图标按钮）。
- **`WorkspaceSwitch` 进入 `'conversation'`、`TaskDetail` 进入 `'details'`，优先级均为 -1**——ui-conversation 的 roster 行保留：其 11 个声明席位、`useInput` 标准件与 `conversation` 服务为休眠占位生态服务，因此 fork 占据者*遮蔽*上游优先级 0 的占据者（最低存活优先级渲染；同优先级二次注册抛错）。中栏按选中项在分组空态任务容器与 Agents/设置 占位页之间切换；右栏承载选中任务的详情容器（由[任务进度板块](2026-08-26-daypaw-task-progress.zh.md)填充）。
- **选中态经 inject 的 `hooks` 舱位跨 scope**——一个 store 句柄不能挂在两个 scope 下（注册表抛错），因此一个 apply 闭包自有的 `InboxSelectionController` 持有裸 `SnapshotStore<InboxSelection>`（`{ kind: 'group', group } | { kind: 'agents' } | { kind: 'settings' }`，默认「进行中」分组），在每个 register 调用的 `hooks: { selection }` 中相同地露出；渲染器把它绑成各组件的 `useSelection` hook，依 [slot 系统标准](../architecture/2026-07-22-slot-type-chain-implementation.zh.md)。注册顺序无需 `ctx.slots.inject` 即安全：cordis fiber inject 等待 `layout` 服务，而 ui-layout 在声明四个 slot 的同一 effect 里提供它（ui-sidebar 先例；[slot 声明注入笔记](../architecture/2026-08-05-slot-declaration-injection.zh.md)的机制留给像 pending 的 ui-workspace 那样顺序独立的贡献方）。
- **locale 与样式遵循 roster 惯例**——插件经 `LocaleNamespaceMap` 合并拥有 `inbox` 命名空间，注册 zh 与 en（类型化 register 要求每个已发布 locale；查找链回落到 zh，即产品文案）。样式只用 CSS Modules 消费 `--dsw-alias-*` 语义 token 与 `--dp-space-*` 密度尺度（两者现由[品牌主题层](2026-08-27-daypaw-shell-brand-theme.zh.md)供给；骨架期以手设中偏低间距落地，后由同一票 token 化）。

测试遵循 [GUI 测试系统](../process/2026-07-20-gui-testing-system.zh.md)的零机械正路：组件 spec 以真实 props 直渲（真 controller 加 `bindSnapshotSelector` 绑 hooks 舱位，框架席位用永不被调用的桩），apply spec 在真实 `SlotRegistry` + `LocaleRuntime` 上钉住占位、-1 遮蔽、共享选中源与拆卸，另有一个 `toMatchSnapshot` 钉住展开态骨架。包 src 达 per-file 100% 覆盖。新增的 core touch（tsconfig.client.json 引用 + css-modules include、knip workspace 块）登记在 [CORE_TOUCHES.md](../../../../docs/fork/CORE_TOUCHES.md)。

## 否决的备选

- **连 ui-conversation 的 roster 行一起移除**——否决：其声明席位与服务是休眠生态的组合面（ui-tool、ui-deliverables 等都注册进去），移除的爆炸半径大而骨架零收益；优先级 -1 遮蔽恰好只替换两个可见单元格，该行的 slot 声明保持存活。
- **以优先级 -1 遮蔽 ui-sidebar 而非移除其 roster 行**——否决：保留上游壳挂载能让其声明席位继续供 ui-workspace/ui-settings-general 使用，但那些注册本身是排定 wholesale 重写的占位，且不可见的上游壳仍握着导航的呈现契约；移除是重写簇的终局，而 pending 的依赖方按设计静默失败。
- **一个共享 store 句柄注册到全部三个 slot**——不只是否决而是不可能：slot 注册表对一个句柄挂在两个 scope 下会抛错，而三个 per-scope 句柄会把工作台赖以存在的选中态分叉；inject 的 `hooks` 舱位是标准认可的 registrant 私有响应式事实通道。
- **用 `ctx.slots.inject` 等待 slot 声明**——对本包否决：对 `layout` 服务的 fiber inject 已把本插件排在 ui-layout 的声明 effect 之后（ui-sidebar 同样如此），而 `slots.inject` 面向激活顺序独立于声明方的贡献者，同组合的栏目占据者不是。

## 后果

daypaw web 面端到端渲染收件箱工作台骨架——左栏导航带分组/计数位与次要导航、中栏随选中项切换、右栏详情占位——而上游开发者向的对话面不可见但仍挂载在底下。后续每张板块票（计数/条目接线、新任务对话框内容、Agents/设置 页、任务详情）都扩展本包组件或替换其占位，不动框架。代价：被遮蔽的 ui-conversation 占据者仍加载、其席位仍接受注册，组合在板块票移除它之前一直带着这棵休眠树；且 fork 的三栏文案从此独立于上游 sidebar/conversation 的演进各自漂移。

## 暂缓

最终移除被遮蔽的 ui-conversation 行仍为后续票范围，在包 README 的 Known Limitations 中镜像记录。设置 页：[daypaw 设置单页与首跑 API-key 黄卡](2026-08-24-daypaw-settings-first-run-card.zh.md)。分组计数、任务列表、新任务对话框与对话视图：[daypaw 任务对话](2026-08-24-daypaw-task-conversation.zh.md)。Agents 目录页：[daypaw agent 目录页](2026-08-25-daypaw-agent-catalog.zh.md)。run 供给的板块与选中任务详情栏：[daypaw 任务进度板块](2026-08-26-daypaw-task-progress.zh.md)。
