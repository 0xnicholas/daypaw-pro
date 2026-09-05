# Agent Note: durable/* fixture 应答迁装饰器 transport

Status: implemented

[English](2026-09-06-durable-fixture-decorator-transport.md) | 中文

## 问题

daypaw fork 的 `durable/*` Remote 应答原住在上游浏览器 fixture（`packages/client/connection/src/client/fixture.ts`）里：六个 rpc 臂、三张可变表、rerun/start 串行——约 370 行上游文件内的 fork 代码，每次 sync 手工重放，durable 契约每变一次都要三处镜像（前端债审计 §2.1，wayfinder #81 裁决 1）。spike 悬问是 fork 自持装饰器能否连带驱动 `durable/startRun` 的会话孪生——fixture 臂原经内部件驱动（`sessionApi.prompt`、`emitRemote('api-session/added')`）。

## 决策

应答现居 `apps/daypaw-web/tests/durable-rpc.ts`：`decorateDurableRpc(base)` 拦截六个 `durable/*` 端点、自持表，其余调用与流透传。组装 boot 经 connection 插件既有的载体覆盖缝（`__DSH_TRANSPORT__`）装配：单次调用经 fetch 桥跨真实的 ClientRequest/ServerResponse 信封，流委托 fixture 的进程内 open，带 `?fixture` 查询开关装载则失败报错。会话孪生经 fixture 公开面驱动——`session/create` 注册孪生（sessionId ≡ runId、模型默认值、`api-session/added` 远程事件），`session/prompt` 驱动首轮——窄接口 `ClientConnectionRpc` 足够，不触任何 fixture 内部件（spike 第一问，已答）。上游侧唯一增项是 client 入口公开再导出 `createFixtureConnectionRpc`：载体钩子需要工厂，而 `./src/*` 子路径导入过不了会 emit 的 client 面。

## 后果

上游 fixture 只保留登记在案的 fx 世界种子调整（approval 对、turn-75 todo 样本、fx-gamma 常驻 question、`flipGammaRunning`、approvalHistory 折叠）；durable 镜像义务整体落入 fork 领地，组装车道改为骑与服务 web 应用 HTTP 载体相同的请求信封。fixture 场景开关仍然生效，由桥铸造世界时从已装载的 search 读取。五条 golden 车道输出逐字节不变。spike 结论为肯定，迁移即由本次变更完整落地：无后续立案，审计的反转选项就此闭项（fx 种子调整作为该项残余继续登记）。

## 备选方案

保留登记是审计废止的现状：表随每个 durable 特性增长，镜像义务在 sync 上无解。fork connection 插件覆盖 `ctx.connection` 被否：复制整个插件 apply 体，重放面比六臂更宽。经 `./src/*` 子路径导入 fixture 模块被否：非相对 `.ts` 导入在 `rewriteRelativeImportExtensions` 的 emit 面无法改写（TS2877）。从构建产物导入 fixture 被否：构建的 client 入口未导出工厂，源面再导出是同一修复的一行形。

## 测试

`apps/daypaw-web/tests/durable-rpc.spec.ts`（自 connection 包的 `fixture-durable.client.spec.ts` 迁入）直驱装饰器：ledger 查询、lineage、journal、rerun 追加、startRun 注册表解析（含 `durable/*` 失败词汇）、以及经公开 session 面读到孪生首条 user message。五条组装 golden 车道装载装饰器 transport，与已提交 golden 逐字节一致。
