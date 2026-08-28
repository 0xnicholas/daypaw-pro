# Agent Note: daypaw 定义注册表只读视图

Status: implemented

[English](2026-08-25-daypaw-definition-registry-view.md) | 中文

## Problem

Issue #51（spec 05 §5，后端面增量第二项）给产品壳的 agent 目录提供 core 查询：枚举全部已注册定义及其展示元数据。注册表是 `DurableEngineCore` 内部的私有 `Map`——host 够不到——#44 缺口 6 的裁决把落地侧判给引擎：暴露只读视图，core 保持无 Cordis 依赖形态。本票与 #52（`defineAgent` 展示字段）配套：#52 负责声明本视图承载的元数据，因此引擎侧现在要同时落下载体字段与读面。

## Decision

- **`EngineDefinition.display?: DefinitionDisplay`** —— 定义记录增加可选的展示元数据载体（`title` + `description`，即 #40 的下限集合）。它只是元数据：引擎执行从不读它，引擎层词汇不变。
- **`DurableEngineCore.listDefinitions()`** —— 按登记顺序枚举注册表，返回全新的 `{ kind, name, version, display }` 拷贝（`display` 对象也拷贝），调用方无法经结果够到私有 `Map` 或表内记录，body 永不离开 core。与[查询面](2026-08-25-daypaw-engine-query-face.zh.md)一致，该读不带 disposal 断言：dispose 后可读对齐 `handle.status()` 先例。
- **`ctx.durable.listDefinitions()`** —— 服务层异步包装，与其他方法一样生成进 cordis catalog。`DefinitionView` 与 `DefinitionDisplay` 落在 `core.ts` 注册表旁；catalog 生成器的 `TYPE_LINK_EXEMPTIONS` 把两者指向引擎 README。
- **不落盘** —— 注册表在每次进程启动时由登记重建，展示元数据随进程内记录走，无需 ledger 列或迁移。

## Alternatives considered

- **展示元数据落 ledger 表** —— 否决：注册表按构造就是瞬态的（body 是只存在于进程内的闭包），持久化什么都买不到；host 每次 boot 后重读活注册表即可。
- **直接返回已注册的 `EngineDefinition` 对象** —— 否决：那会暴露 body thunk 并让调用方改到表内记录；专用 `DefinitionView` 在类型层把只读面钉死。
- **`display` 载体留给 #52** —— 否决：#51 的验收是枚举定义*及其*展示元数据；没有载体字段，#52 还是得回头再开引擎包。
- **SDK facade 镜像** —— 超本票范围，与查询面同理：消费方是 Cordis host，`@daypaw/sdk` 待库层消费方出现时再镜像。

## Consequences

目录票经 `ctx.durable` 枚举定义及其业务名与描述，不碰 core 内部。代价：`ctx.durable` 多两个类型与一个方法；登记顺序（`Map` 插入序）成为文档化契约。

## Testing

`packages/daypaw/engine/tests/queries.spec.ts` 经 `ctx.durable` 服务驱动 `listDefinitions`：空注册表、带与不带 `display` 的登记顺序、重复登记 no-op、快照隔离（改返回条目或其 `display` 够不到注册表）。engine src 保持 per-file 100% 覆盖。

## Deferred

查询/读面的 SDK facade 镜像待库层消费方出现。配套的 `defineAgent` 侧已随 #52 落地：[defineAgent 展示字段](2026-08-25-daypaw-define-agent-display-fields.zh.md)。
