# Agent Note: 两条 web 车道共一个参数化 assembled-boot 之家

Status: implemented

[English](2026-09-19-daypaw-assembled-boot-shared-scaffold.md) | 中文

## 问题

`apps/daypaw-web/tests/assembled-boot.ts`（360 行）与 `apps/web/tests/assembled-boot.ts`（305 行）是近克隆：同样的 bundle 图推导、jsdom 环境与挂载序列，2026-08-28 sync 时手工拷贝、此后逐次手工重放。fork 份已长出两处漂移——`__DSH_TRANSPORT__` 载体 transport（[票 #90](https://github.com/0xnicholas/daypaw-pro/issues/90)）与声明制 config 转发（[票 #105](https://github.com/0xnicholas/daypaw-pro/issues/105)）——还带着一个死掉的 `skipped` 计数器和一套与上游本体不同的条目展开形态（`inject: declaration.inject ?? []`，无行为理由）。上游 5–8 月约 15 次触碰其副本，每次 sync 都押一次手工重放（[票 #123](https://github.com/0xnicholas/daypaw-pro/issues/123)）。

## 决策

一个 fork 局部包 `@daypaw/assembled-boot` 拥有脚手架本体；各车道的 `tests/assembled-boot.ts` 是传 lane 选项的薄入口。lane 事实共三轴——bundle 层（base 可覆写、web 层必给）、transport 装配（`ClientTransportHooks` 载体工厂；缺省表示页面经 `?fixture` 搜索开关自选 fixture transport，载体车道则拒绝该键）、钉制的文档标题。config 转发是共享能力而非选项：行携带 config 且包声明 `dsh.client.config` 才进图，对上游花名册是空操作。locale 钉制（`en-US`）两车道本就相同——fork 份旧头注自称钉中文与自己的代码相悖——因此住进共享 module；两车道的 golden 都渲染英语词典。条目展开形态统一为上游本体的条件展开；统一后两车道套件全绿，形态差不承载行为。

`decorateDurableRpc` 留在 `apps/daypaw-web/tests`、以载体 transport 的身份注入，共享体内零 daypaw 词汇。`ClientRequest`/`ServerResponse` 桥以 `connectionRpcCarrier` 导出——它只说上游类型。

时机：现在提取，不等上游下次重构该脚手架顺车。两种情形的重放都是「换体 + 重穿三缝」；等待只会在 fork 侧持续演化消费面时长漂移。上游无接受通道（[票 #118](https://github.com/0xnicholas/daypaw-pro/issues/118) 已裁定），「上游形态」因此是对交给上游那些文件的承诺，而非提交：两处上游文件 core touch 标「可提」，退役触发——上游自建同等参数化后下次 sync 换家——记入 README 与 ADR 0015。

覆盖率：组合半边导出为可测单元（`loadAssembledPlugins` / `buildBootGraph` / `buildBundleTable`），微花名册 fixture（一个 bootstrap 插件、一个 application 插件、外加覆盖全部跳过分支与 config 转发的行矩阵）不启动真实花名册即驱动分支矩阵。挂载与环境覆盖在包内以微车道过 per-file 100% 门；两条真实车道各自的套件仍是端到端证明。

## 考虑过的替代方案

**等上游下次重构顺车提取。** 赌上游在下次重放到期前先重写；赌输即再付一次重放、漂移继续长。缝在换体后保持稳定，顺车几乎买不到东西。

**只提取组合半边，env/mount 胶水留在各车道。** 恰好保留上游最常改的那部分的两份副本，重造它声称要解决的问题。

**`packages/test-support/` 组内新子包，或塞进既有上游 test-support 子包。** 前者破坏 family 规则（`@daypaw/*` 住在 `packages/daypaw/`）且要给 `families.ts` 加跳过项（本身又一次 core touch）；后者把 fork 需求种进上游包源码树。

**`@daypaw/durable-client` 或某 `ui-*` 包当家。** 稀释 wire 词汇之家，或把测试脚手架拖进 GUI 家族的覆盖率豁免语义；per-file 门才是纯逻辑的诚实姿态。

## 后果

- sync 重放语义已变：上游对 `apps/web/tests/assembled-boot.ts` 的改动会与 stub 冲突；解法是取上游本体替换进 `src/composition.ts` / `src/index.ts`、重穿三条选项缝、恢复 stub。选项不变即零重放。
- 漂移类被消掉、不只是这一例：fork 独有的特性（`durable/*` 载体、config 转发）此后只落一次、经选项同时抵达两条车道；死掉的 `skipped` 计数器与分岔的条目展开形态一并退役。
- 本包承担 per-file 100% 覆盖率门：组合半边导出为可测单元，微花名册 fixture 驱动分支矩阵，不必靠整图启动维持覆盖。
- 三处上游文件 core touch 已登记 [CORE_TOUCHES](../../../../docs/fork/CORE_TOUCHES.md)：stub 重写、`apps/web/tsconfig.json` 引用、`apps/web/package.json` devDependency。

## 给后续会话的备注

- 包在所有消费方经 tsconfig paths 解析到 `src/`；其 `lib/` 构建只为 workspace 构建布局而存在（`clientLibrary` 预置、`@deepseek-ai/*` 依赖声明为 peer 保持外置——即 `@deepseek-ai/dsh-client-test-runtime` 的声明形状）。
- [ADR 0015](../../../../docs/adr/0015-assembled-boot-shared-scaffold-home.md) 记录裁决。
