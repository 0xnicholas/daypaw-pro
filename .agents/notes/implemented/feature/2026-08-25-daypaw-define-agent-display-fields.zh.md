# Agent Note: daypaw defineAgent 展示字段

Status: implemented

[English](2026-08-25-daypaw-define-agent-display-fields.md) | 中文

## Problem

Issue #52（spec 05 §5，后端面增量第三项）声明产品壳 agent 目录经[定义注册表只读视图](2026-08-25-daypaw-definition-registry-view.md)读出的展示元数据：业务名 + 描述（#40 的下限集合）。引擎载体（`EngineDefinition.display`）随 #51 落地，但 SDK 声明面没有声明它的入口，定义什么都不声明时的行为也没有定义。

## Decision

- **`DefineAgentOptions.display?: DefinitionDisplay`** —— `defineAgent` 增加可选展示对（`title` + `description`），复用引擎的载体类型，不另立 SDK 本地孪生。`AgentDefinition` 承载它，`bindAgent` 把它透传到所登记的 `EngineDefinition`，于是 `ctx.durable.listDefinitions()` 随身份读回。
- **声明期校验** —— 声明了 `display` 但 `title` 或 `description` 为空（含纯空白）即在声明期 throw，沿用 `maxTurns` 先例：目录卡片业务名为空是配置错误，配置错误在最早可判定处 loud fail。
- **未声明回落** —— `display` 端到端保持可选：未声明的定义不带它登记，只读视图报 `display: undefined`，目录呈现回落到技术 `name`、无描述行。回落是呈现约定，记载于引擎/SDK README 与 `CONTEXT.md` 的壳词汇节；引擎自身从不读 `display`，引擎层词汇不变。
- **仅元数据** —— 执行路径、prompt、工具都看不到展示字段；模型可见面不变，snapshot fixture 不动。

## Alternatives considered

- **声明期把 `display.title` 默认成技术 `name`** —— 否决：抹掉只读视图契约（#51）已定义为 `undefined` 的已声明/未声明之分，合成展示与作者所写无从区分。
- **回落推进引擎**（`listDefinitions` 用 `name` 补 `title`）—— 否决：呈现约定停在引擎缝之上；引擎原样返回所声明的内容。
- **同变更给 `defineWorkflow` 镜像 `display`** —— 超本票范围：#40 的映射只把 agent 定义做成目录卡片；workflow 面待消费方出现时再镜像。

## Consequences

目录票的数据通路闭合：在 `defineAgent` 声明、bind、经 `ctx.durable.listDefinitions()` 读出。代价：声明面多一个带校验的选项；回落规则从此对呈现方是契约。

## Testing

`packages/daypaw/sdk/tests/agent.spec.ts`：声明期空字段拒绝、`bindAgent` 后所声明 display 经 `ctx.durable.listDefinitions()` 读回、未声明回落（`display: undefined`，呈现方回落到技术 `name`）。SDK src 保持 per-file 100% 覆盖。

## Deferred

`defineWorkflow` 的 display 镜像待 workflow 目录消费方出现；卡片渲染归 agent 目录页票。
