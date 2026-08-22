# 第 0 章：总览

> 状态：**完整章**（批次 D，按 ADR 0008 §2 最后写——落地包形与 bundle 输入最全时一次写准）。决策依据：[ADR 0006](../adr/0006-engine-package-structure.md)（包结构）、[ADR 0008](../adr/0008-landing-order-walking-skeleton.md)（落地顺序）、[ADR 0009](../adr/0009-pillar-review-manager-evo-deferred.md)（现行 frame）、[ADR 0011](../adr/0011-customer-self-run-delivery.md)（交付形态与版本契约）。章节状态索引见 [README](README.md)。

## 1. 定位与现行 frame

daypaw-pro = deepseek-harness（dsh）的 fork + in-tree 扩展，在 dsh 的会话基座上补一层**跨 turn / 跨进程的编排 durability**。分层一句话：dsh 拥有「对话」的持久性（session log，模型可见的一切），daypaw 补上「做事」的持久性（engine ledger，run 生命周期与 step 事实的唯一权威）——进程死了，对话史活着，「正在做的事」由 Durable Engine 自己复活。双事实源契约、双向引用与边界语义见[第 1 章 §1](01-durable-execution.md)。

```
用户应用（TypeScript）—— defineWorkflow / defineAgent → def.run() → RunHandle   ← @daypaw/sdk（纯库）
Durable Engine（ctx.durable 插件）—— step 去重 · boot 扫描 · claim · 定义注册表  ← @daypaw/engine
Engine Ledger（SQLite WAL）                                                   ← @daypaw/store
dsh 基座（上游，不改不碰）—— session log · agent loop · tools · preset · ……
```

现行 frame（ADR 0009）：**两支柱现役 + 两个远期独立子项目**。外部参照系 = Palantir Agent Stack，整合裁决（嵌入而非外接、拒绝进口词汇、复用 dsh 组合语义等）散在 [ADR 0002](../adr/0002-durable-execution-semantics.md) / [ADR 0003](../adr/0003-engine-sdk-programming-model.md)，综合导览见[架构总结报告](../reports/2026-08-19-architecture-review-summary.md)。

| 支柱 / 子项目 | 面 | 章 |
|---|---|---|
| ① Durable Execution | Durable Engine：journal、step 去重续跑、boot 扫描、claim 单写者、持久 timer/promise | [第 1 章](01-durable-execution.md) |
| ② Agent Engine + SDK | defineWorkflow / defineAgent + run()/RunHandle 编程模型 | [第 2 章](02-agent-engine-sdk.md) |
| ③ Agent Manager（远期子项目） | 人的观测与控制窗口：run 视图 + 控制命令 | [第 3 章](03-agent-manager.md)（方向文档） |
| ④ EVO（远期子项目） | agent 定义的持续优化循环，产出止于提案 | [第 4 章](04-evo.md)（方向文档） |

设计约束（ADR 0009 后果，ADR 0011 修订）：单机、本地、无多租户、无计费不变；客户自跑分发与版本契约进入范围——npm 两层自含单包（库 + CLI）、SDK 公共 API 面 semver-ish、不承诺跨 artifact 版本续跑在飞 run，详见 [ADR 0011](../adr/0011-customer-self-run-delivery.md)。

## 2. 包图（对落地实况）

```
packages/daypaw/
├── engine/   @daypaw/engine   cordis 插件（ctx.durable）：定义注册表、run 生命周期、step 去重续跑、claim 单写者、boot 扫描
├── sdk/      @daypaw/sdk      纯库 facade：defineWorkflow、bind、run()/RunHandle（类型化结果）
├── store/    @daypaw/store    共享 SQLite 契约：schema 常量 + 行类型 + 手写 SQL 迁移骨架（无业务逻辑）
├── (预留) manager/            host 侧路由 + manager host 进程——子项目立项时建（ADR 0009）
├── (预留) evo/                优化 workflow 定义 + 自身表——同上
└── (预留) ui-*/               Manager client 侧插槽插件——同上
```

依赖方向铁律（ADR 0006 §1）：`sdk → engine → store`；manager/evo → store（+各自所需）；**manager 与 evo 不被任何包依赖**；engine 不依赖 sdk。各包契约归其 README；`ctx.durable` 类型面见 [subsystems/daypaw-engine](../subsystems/daypaw-engine.md)；加包程序见 [docs/fork/adding-a-daypaw-package.md](../fork/adding-a-daypaw-package.md)。

## 3. Profile / bundle 面（ADR 0006 §5 裁决）

daypaw profile 的组合面 v1 = **单行插件配方**：

```yaml
- id: daypaw-engine
  name: '@daypaw/engine'
  config:
    path: daypaw/ledger.db
```

- **storage sqlite 后端不是独立行**：落地形态是引擎内置 `SqliteJournalStore`，由 `path` 选择、`JournalStore` 缝可替换（[第 1 章](01-durable-execution.md) §7）——ADR 0006 §5 的「engine 插件 + storage sqlite 后端」收敛为单行。
- **SDK 不是组合行**：纯库，应用代码 `bind(def, engine)` 挂到 `ctx.durable`（[第 2 章](02-agent-engine-sdk.md) §1.1）。
- **上游三族（jobs/workflow/schedule）默认不装**（[第 1 章](01-durable-execution.md) §1 旁立裁决）。
- config 契约（`path` / `pollMs`）见 [engine README](../../packages/daypaw/engine/README.md)。

**分发形态（ADR 0011）**：客户交付走 CLI 自含单包——daypaw profile 模板随 `@daypaw/cli` 包自带、首跑自初始化；源码态组合仍是宿主在自己的 cordis.yml 写同一插件行（[examples/daypaw-skeleton](../../examples/daypaw-skeleton/README.md) 示范）。模板不进上游 `PROFILE_TEMPLATES`：`daypaw` bin 每次启动先播种再引导 vendored dsh bin——首跑物化 `$DSH_HOME/profiles/daypaw`（bundles = `dsh-base` + `dsh-headless`；上面的单行配方以 `- insert:` 行落进 profile 自己的 `cordis.patch.yml`，随用户层语义归客户所有），并把闭包内的 `@daypaw/engine` 软链进 profile 的 `node_modules`（launcher 维护的模块 fallback 只覆盖 dsh app 依赖闭包，够不到 daypaw 族）；播种幂等、永不覆盖既有文件。独立 `@daypaw/bundle` 包不发布：单行 patch 的复制成本近零，CLI 包内 profile 模板已承担组合面分发；接线点不变——`dsh.bundle.patch` manifest 契约（[packages/bundle](../../packages/bundle/README.md)）+ `dsh plugin --profile <name> add <package>` 安装。

否决：独立 bundle 包与 CLI 包并行发布——同一组合面两个分发载体纯增维护面（README limitations 门、hygiene），与「按需落地、勿提前实现」裁决相悖。
