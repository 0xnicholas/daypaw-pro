# @daypaw/approval-history

[English](README.md) | 中文

daypaw 浏览器壳的 session 投影单元 `approvalHistory`。本插件把 [`@deepseek-ai/dsh-user-approval`](../../interaction/user-approval/README.md) 声明的 `approval/asked` + `approval/decided` 审计事件对折叠成按序的每会话审批列表，供任务详情面板的「审批历史」区块渲染，并注册到 `ctx.sessionProjections`。插件只拥有折叠逻辑；投递（快照、变更订阅、持久缓存）由 seam 负责。

## 投影单元

- 键 `approvalHistory`，`stateVersion: 1`。
- 值：条目数组（只读），每次询问按日志顺序一条 —— `{ id, toolName, reason?, outcome? }`。`id` 即询问的 `ApprovalRequestId`；配对的 `approval/decided` 按 `id` 落入 `outcome`。尚无决定的询问保持无 outcome。询问未携带 `reason` 时该键缺省（绝不以 undefined 值存在）；事件的 `callId` 留在日志中，不做投影。
- `approval/decided` 的 id 未匹配到任何已记录询问时折叠返回同一状态引用（忽略）：审批服务在一切合法日志中都先落询问事件，未知 id 无对象可配对。
- 无关事件返回同一状态引用 —— 注册表的 `Object.is` 无操作门。

`./types` 出口携带 `SessionProjectionMap` 合并，浏览器消费方可类型安全地调用 `useProjection('approvalHistory')`。

## Model Experience

### 存储的领域记录

#### 模型看到什么

什么都没有。本包不贡献任何 prompt、工具或 schema；它把仅落日志的 `approval/asked` + `approval/decided` 审计事件折叠成浏览器壳的 `approvalHistory` 读模型。

#### Token 影响

零实时请求 token。

#### KV Cache 影响

无 —— 该投影从不进入实时请求前缀。

## Known Limitations and Deferred Work

- **渲染不在本包范围** —— 本包只提供投影值；「审批历史」区块的 UI 在 fork 的 client 层（ui 包）。
- **无逐调用粒度** —— 每次询问一条；跨多个工具调用的询问（无 `callId`）是单行，具体调用的 `callId` 只能从日志本身取回。
