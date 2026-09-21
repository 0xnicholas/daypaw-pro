# ADR 0018: 免 key 世界建在 RemoteMock 上——fixture 世界的家

- **状态**：已接受（2026-09-21，[fixture 世界迁 RemoteMock（路径 A 着陆）](https://github.com/0xnicholas/daypaw-pro/issues/142)）
- **前置**：ADR 0001（同步策略与 fork 卫生——§4 core 触碰三问）；ADR 0015（assembled-boot 脚手架的家——本决策在同一接点上续做）；[durable/* fixture 迁装饰器 transport](https://github.com/0xnicholas/daypaw-pro/issues/90)（装饰器 transport 先例）
- **事实底座**：上游的接替面分两次落地——`@deepseek-ai/dsh-remote-mock`（端点名规则表、流脚本、调用日志、`assertNoUnmatched()`）与 `@deepseek-ai/dsh-client-test-runtime` 的 assembly tier 随 2026-09-13 sync 进入 fork 树；删除浏览器 fixture（fork 树内 4,136 行 + 1,782 行 spec）的提交尚未进入。`RemoteMock.rpc` 的声明类型即 `ClientConnectionRpc`，与 `decorateDurableRpc(base: ClientConnectionRpc)` 同型。上游 `session/prompt` 规则只落 `turn/start` 与 `user/message` 事件并返回 `{accepted:true}`——assistant 回声不是上游行为。

## 决策

### 1. fork 的免 key 世界建在 RemoteMock 上

十条 golden 车道所需的世界（会话列、fx-alpha 记录与投影值、设置面、`$events` 与 `session/follow` 脚本）由 fork 自有的 scenario 模块表达；旧 fixture 及其 spec 不在 fork 留副本，随上游删除消失。

### 2. scenario 是 TS 模块

单文件、带类型的字面量：fork 场景含行为（回声生成、规则注册），且种子必须自行编辑（带 `callId` 的审批对、turn-75 `todo_write`、常驻 question 归 fx-gamma），上游那份 JSON 世界用不上。

### 3. carrier 轴保留在 fork 侧

lane 的 carrier 是 `connectionRpcCarrier(decorateDurableRpc(scenario.mock.rpc))`：`durable/*` 七端点继续由 `apps/daypaw-web/tests/durable-rpc.ts` 的装饰器应答，装饰器与其单测不动。装饰器是透传包装——非 `durable/*` 的调用与全部流落回 mock，未知 `durable/*` 名也透传，故 `assertNoUnmatched()` 的覆盖不因装饰器残缺。

### 4. 上游 e2e 的 fork delta 按默认退役处置

`apps/web/tests/{built-boot.expected,todo-row.expected}.e2e.ts` 的 fork 改动（`Waiting for answer` → `Waiting for approval`、头注 turn 74 → 75）成因是 fork 改了共享 fixture；世界搬出共享文件后成因消失，故上游新本体落地时以上游原样文件跑该车道——绿则删两条 [CORE_TOUCHES 登记行](../fork/CORE_TOUCHES.md)，红才按旧 delta 重放。

## 考虑过的替代方案

**把旧 fixture 搬进 fork 私有包**：一次性成本最小（搬运 + 改导入），但永久持有 4,136 行上游派生 harness 与 1,782 行 spec，每次 sync 跟随 production 面漂移（本窗口上游给 `ClientTransportHooks` 加了 `streamBaseUrl?`，fork 副本没有），并与 ADR 0015「近克隆每次 sync 都要重放」的去重立意相抵。

**把 `durable/*` 折成 mock 规则**：换来 scaffold 的 transport 安装与上游同形、全部端点单表断言；代价是 516 行改居 + 277 行单测重写，而 `RemoteMock.rpc` 与装饰器已同型，折入无技术必要。

**以上游 JSON 世界作基 + fork 覆写层**：省下世界数据，但耦合到一个上游测试文件（非包导出、无兼容承诺），且 fork 种子差异（`callId` 配对、turn-75、question 归属）大到覆写层未必小于全写。

## 后果

- fork 不再持有上游派生的浏览器 fixture；sync 存活成本降到「scenario 模块与上游本体之间的接口」。
- 世界归 fork 所有：上游改自己的 JSON 世界不影响 fork 车道；反向代价是 fork 世界的每处新事实都要自己写。
- `assertNoUnmatched()` 取代旧 fixture 的静默兜底：未声明端点从静默吸收变为响亮失败。
- `packages/daypaw/assembled-boot` 仍是上游 `apps/web/tests/assembled-boot.ts` 的参数化副本（ADR 0015 的形态）；换穿新本体时其三个车道轴重读为「bundle 层 / remote 场景 / 标题」。
- 验收线：十条 golden 车道全绿 + `pnpm run test:web:daypaw:built` + `CI=true pnpm run release:daypaw`。
