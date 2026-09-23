# Agent Note: daypaw 的 RemoteMock 世界（`apps/daypaw-web/tests/daypaw-remote.ts`）

Status: implemented

[English](2026-09-23-daypaw-remote-mock-scenario.md) | 中文

## 问题

fork 的十条 golden 车道踩在共享的上游浏览器 fixture（`packages/client/connection/src/client/fixture.ts`，fork 树内 4,136 行）上启动，fork 的世界事实——带 `callId` 的审批对、常驻待审批之后承载 `todo_write` 样本的 turn 75、停在 fx-gamma 上的问句 waterfall——作为种子编辑活在上游文件内，登记为 core touch。上游以 `@deepseek-ai/dsh-remote-mock`（端点规则表、流脚本、调用日志、`assertNoUnmatched()`）加 client-test-runtime 的 assembly tier 接替该 fixture；删除提交随 2026-09-27 sync 窗口落地。fork 的世界迁到接替面之前，每次 sync 都在排练一个将死的 fixture，车道也没有能活过删除的家。

## 决策

fork 的免 key 世界是单文件 TS 模块 `apps/daypaw-web/tests/daypaw-remote.ts`（[ADR 0018](../../../../docs/adr/0018-remote-mock-scenario-home.md)）：`RemoteMock.create()` 叠在 assembly tier 的 `remoteDefaultResponses` 上，fx 世界事实以带类型字面量与规则表达。种子事实（fx-alpha 的 76 轮历史、投影折叠、`$events` waterfall、带 assistant 增长帧与 `turn/end` 的 prompt 回声生成器）自退役 fixture 原样搬入，已提交的 golden 保持字节稳定——落地时十条车道全绿、golden 零差异。

carrier 轴保留在 fork 侧：`connectionRpcCarrier(decorateDurableRpc(world.mock.rpc))`。`durable/*` 仍由 `durable-rpc.ts` 装饰器应答（其 ledger、journal、注册表不动）；装饰器是透传包装，`assertNoUnmatched()` 的覆盖不因它残缺。车道 `assembled-boot.ts` 的 teardown 在 lane 自身的卸载钩子之后（vitest afterEach 逆注册序）跑 `assertNoUnmatched()`，车道够到的未声明端点响亮失败，不再像 fixture 那样被静默吸收。

世界的活路径控制以类型化句柄返回：`createDaypawRemote()` 返回 `{ mock, appendApproval }`，`durable-rpc.spec.ts` 经由它驱动活 approvalHistory 帧。fixture 安装的 `__fxTiming` 全局退役。

两处配置前置让跨包源码导入在 pnpm 严格模式与 `tsc -b` 下解析：`apps/daypaw-web` 声明 `@deepseek-ai/dsh-remote-mock` 与 `@deepseek-ai/dsh-client-test-runtime`（以及值导入的 `dsh-llm`/`dsh-session`/`dsh-brand`/`dsh-tool-todo`），并带对应 tsconfig 项目引用。缺引用时 `tsc -b` 报 TS6307/TS6059 并向 `packages/test-support/*/src` 泄出 `*.js` 污染。

落验收线还需在 release sdk 冒烟的 peer 安装中钉住 `@deepseek-ai/cordis`（`scripts/release/daypaw.ts` 的 `externalPeerPins`）：registry 在 sdk 的 `~4.0.1` peer 区间内供 cordis 4.0.4，消费者的 cordis 类型与闭包不再合一（`ctx.durable` 缺席、`ctx.plugin` 选项退化）——正是既有 zod 钉版针对的漂移类。钉版解析工作区（vendored）版本，与 zod 同路。

## 考虑过的替代方案

**把旧 fixture 搬进 fork 私有包。** 一次性成本最小，但永久持有 4,136 行上游派生代码加 1,782 行 spec，随生产面漂移，与 ADR 0015 的近克隆纪律相抵。ADR 0018 已否决。

**把 `durable/*` 折成 mock 规则。** 全部端点单表可断言；代价约 800 行重排（装饰器加其 277 行 spec），而 `RemoteMock.rpc` 与装饰器的 `ClientConnectionRpc` 同型，无技术必要。保留装饰器。

**以上游 JSON 世界为基加 fork 覆写层。** 上游 fixture JSON 是无兼容承诺的测试文件，且 fork 种子差异（callId 配对、turn 75、question 归属）大到覆写层未必小于全写。

## 后果

- 车道的世界归 fork 所有：上游改自己的 JSON 世界不再牵动 fork golden；fork 世界的每处新事实都写在 scenario 模块里。
- `assertNoUnmatched()` 点名每条车道够到而无规则的端点；落地期间唯一缺口是 `settings/mutate`（brand-theme 的偏好写入），以 fixture 的只读拒绝应答，偏好写入回落本地持久化。
- scenario 只应答十条车道旅程加装饰器孪生驱动所及（`session/*`、`workspace/create`、设置/凭据/模型面、composer 面）。文件树、目录选择器、goal、搜索端点保持未注册，直到某条车道够到——缺规则是响亮失败，不是静默缺口。
- 随 2026-09-27 窗口（上游文件入树）剩余：`packages/daypaw/assembled-boot` 换上游本体（自建 mock、`__DSH_TRANSPORT__` 安装、`AssembledRemote`、teardown 断言）并重读三个车道轴；删 `createFixtureConnectionRpc` 再导出；按 ADR 0018 §4 退役 `apps/web` 两条 e2e fork-delta 登记行。
