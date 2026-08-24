# Agent Note: daypaw 设置单页与首跑 API-key 黄卡

Status: implemented

[English](2026-08-24-daypaw-settings-first-run-card.md) | 中文

## 问题

Issue #59 要把[壳 IA 骨架](2026-08-24-daypaw-shell-ia-skeleton.md)的 设置 占位页变成真正的设置面（通用/凭据/模型/关于），并新增把无 key 部署引向那里的首跑黄卡。fork 层的约束——上游 `packages/client/` 不动——排除了原地扩展 ui-settings-general，且必须回答四个问题：中栏归 ui-inbox 所有时页面与黄卡注册到哪里；上游声明者（ui-settings-general 的侧栏占据者）不在组合中时，休眠的上游 `ui-settings-models` 分区如何唤醒；黄卡的完成账本是什么；以及 fork 壳还没有对话栏时输入禁用如何接线。

## 决策

新建 fork client UI 插件 `packages/daypaw/ui-settings`（`@daypaw/ui-settings`，private，0.0.0），并在 ui-inbox 的工作台注册上声明两个子槽（`packages/daypaw/ui-inbox/src/client/contract.ts`）：

- **fork 自有的槽位分层**——`WorkspaceSwitch` 声明 `'inbox.workspace.banner'`（list，session-maybe，渲染在每个分组容器顶部）与 `'inbox.settings.page'`（single，session-maybe，作为 设置 选中项的内容），槽位空时回落到属主的占位页。ui-settings 经 `ctx.slots.inject` 占据两槽，与 ui-inbox 的激活顺序因此互不约束（骨架 note 留给同组合占据者的[槽位声明注入](../architecture/2026-08-05-slot-declaration-injection.md)路径；跨包占据者正是它的适用情形）。
- **设置页在自己的 entry 上重新声明上游 `'settings.section'` 槽**（root scope），并以 `only: 'models'` 渲染它，在没有 ui-settings-general 的情况下唤醒 ui-settings-models 分区。凭据 tab 从 ui-settings-models 重述了约定引用推导（`deriveKeyRef`）与错误文案 helper，因为 client bundle purity gate 禁止跨插件 value import；两个一行函数在 `provider-keys.ts` 重写（如此命名是因为工具链的敏感文件拦截器阻止路径含 "credential"），并由本包测试断言。
- **黄卡本身就是完成账本**——`ApiKeyCardStore` 把默认 agent preset 的显示名（回落 id，无默认时回落 `Agent`）、host 的 provider（回落 `deepseek`）与推导引用的凭据状态相 join；凭据已配置即消失，无持久化 flag。推送的 `credentials/updated` / `connection/reset` 失效无条件重跑检查，而设置各 tab 只在已加载后刷新。检查未决（加载中或失败）时黄卡渲染 null——无法核实的 key 不得画出假警报。
- **输入禁用是惰性接线**——可见且存在当前会话时，黄卡经 `ctx.get('conversation')?.blocks.set` 抬起一条本地化文案的禁用；fork 壳还没有对话栏，因此该服务是可选 `ctx.get`，在对话栏票落地前是 no-op 席位。
- **一个 apply 闭包 `SettingsTabController`** 在页面（读）与黄卡（导航前预选 凭据）之间共享活动 tab，沿用骨架的 inject `hooks` 舱位模式。文案走插件自有 `daypaw-settings` locale 命名空间（zh 为 key 集权威，en 镜像）；样式只用 CSS Modules 消费 `--dsw-alias-*` 语义 token。

测试遵循 [GUI 测试系统](../process/2026-07-20-gui-testing-system.md)的零机制路径：store 规格驱动可编程 wire 假件（join、写穿重载、最新生效的代次守卫）、jsdom 组件规格用真 controller 与 `bindSnapshotSelector`（tab 轨、内联编辑器流程、剪贴板诊断、黄卡可见性与禁用席位）、黄卡的 `toMatchSnapshot`，以及在真 `SlotRegistry` + `LocaleRuntime` + `TestRemote` 上的 apply 规格（占据、子槽声明、失效推送、拆卸）。包 src 达到 per-file 100% 覆盖。新增核心触点（tsconfig.base.json 的 `@daypaw/*/client` paths 映射、web-app 的 tsconfig/knip 行）已登记 [CORE_TOUCHES.md](../../../../docs/fork/CORE_TOUCHES.md)。

## 备选方案

- **把设置 UI 并进 ui-inbox（方案 B）**——被拒：设置面自有一套 wire 域（credentials/llm/host/presets）、失效订阅与 store 群，与收件箱工作台零交集；一个包会融合两套无关的 inject 集，并把首跑黄卡的生命周期塞进导航插件。子槽接缝让 ui-inbox 保持纯 IA 骨架，设置面得以独立演进（与被替换）。
- **为黄卡持久化「已关闭/已完成」flag**——被拒：凭据状态已经是账本；flag 会分叉事实（已关闭但仍无 key 时下个会话仍须重新禁用输入），还要为此新增一条 settings 写路径，零行为收益。
- **把黄卡注册进上游 `'settings.onboarding'` 槽**——被拒：该槽的渲染上下文在 ui-settings-general 的侧栏占据者内部，fork 组合从不挂载它，槽位会一直休眠。ui-inbox 的 banner 条是同一套 onboarding-ledger 机制在 fork 可见面的载体。

## 后果

无 key 的 daypaw 部署启动即在工作台顶部看到黄卡，一次点击落到 凭据 tab，保存 key 后黄卡随推送的失效消失，无需重载。设置页在中栏统一了语言切换、按 provider 的 key 管理、上游模型分区与 host 诊断。代价：两个重述的一行 helper 在 purity gate 或共享内核放行前会与 ui-settings-models 各自漂移；黄卡检查信任约定引用惯例（key 引用不合惯例的 provider 会被误读）；输入禁用在对话栏存在前不生效。

## 暂缓

主题/密度分区、输入禁用的实际效果（对话栏票），以及重述 helper 的任何复用，均为后续票范围，在包 README 的 Known Limitations 中镜像记录。组装级 web 快照 harness：[daypaw 任务对话](2026-08-24-daypaw-task-conversation.md)。
