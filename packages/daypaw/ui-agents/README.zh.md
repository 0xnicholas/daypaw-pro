---
description: "daypaw agent 目录页——fork 客户端 UI 插件，占 在其 workspace 注册上声明的 'inbox.agents.page' 子槽。实现 §3/§5 的目录半边：卡片栅格展示每个 agent 的业务名与描述，卡片的详情视图携带注册表标识 name@"
kind: "package-reference"
---

# @daypaw/ui-agents

[English](README.md) | 中文

## 概述

## 目录



daypaw agent 目录页——fork 客户端 UI 插件，占 [`@daypaw/ui-inbox`](../ui-inbox/README.zh.md) 在其 workspace 注册上声明的 `'inbox.agents.page'` 子槽。实现 [docs/spec/05-product-shell.md](../../../docs/spec/05-product-shell.md) §3/§5 的目录半边：卡片栅格展示每个 agent 的业务名与描述，卡片的详情视图携带注册表标识 `name@version`。v1 不提供任何版本操作——标识行是信息，不是控件。

数据来自引擎的定义注册表只读视图（spec 05 §5）：插件经 connection 的通用 RPC 通道调用 Remote 端点 `durable/listDefinitions`，该端点由 API gateway 从 `@daypaw/engine` 的 `TypertRemoteService` 绑定认领（GoalService 先例——零上游 apiproxy 改动）。载荷在 wire 边界校验；畸形应答响亮地落入页内错误态，宿主原始报错措辞永不上屏。宿主保持单一事实源——store 除最近一次加载快照外不自持缓存。

呈现规则住在 catalog store 而非组件里：只有 `kind: 'agent'` 的定义入列（注册表也持有 workflow，它们不是可发起任务的 agent）；定义未声明展示元数据时卡片标题回落到技术 `name`（#52 回落）；无描述的卡片不渲染空行。名册首次打开时加载；详情选中态住在同一 store，重渲染不会重取，离开页面保留已加载快照。

文案走插件自有的 `daypaw-agents` locale 命名空间（zh 产品文案为键集事实源，外加机制性必需的 en 词典；locales 规格保证 run/session/journal 词汇不进任一语言）。样式只用 CSS Modules + `--dsw-alias-*` 语义 token。

## Model Experience

### agent 目录 UI

#### What the model sees

此面无任何模型可见的界面件。`AgentsPage` 把 `durable/listDefinitions` 的载荷渲染给人看；组件不贡献任何 prompt、工具或 schema。

#### Token effect

零实时请求 token。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **无版本操作**——详情页的 `name@version` 仅作标识；版本选择/切换缓做（spec 05 §2：v1 不露死信息）。
- **无注册表变更失效推送**——名册每次挂载只加载一次；首次加载后绑定的定义在下一次打开页面时才出现，注册表没有推送式失效通道。

### 开发备注
