# Agent Note：durable/* Remote 失败词汇

Status: implemented

[English](2026-09-05-durable-remote-failure-vocabulary.md) | 中文

## Problem

fork 的 `durable/*` 私有 Remote 端点一直以裸 `Error` 消息失败：网关把它们编码为 `internal` 码，壳消费端（ui-inbox、ui-agents、ui-tasks）只能解析消息文本，fixture 也以自有的、彼此不一致的纯消息失败应答浏览器。上游 `804b1ffbfc`（下一次 sync 窗内）把整个 Remote 失败词汇收敛为：单一 `RemoteError` 类 + 可合并扩展的 `RemoteErrorDetailsMap` + 域前缀码（`gateway/*`），按码判别。维持现状会让那次 sync 在引擎、SDK、消费端、fixture 四处都变成硬重放。

## Decision

唯一闭集 `durable/*` 码表 + 类型化 details，正典声明在 [`@daypaw/engine` `src/failures.ts`](../../../../packages/daypaw/engine/src/failures.ts)。拥有者在失败点经本树的 wire 失败载体 `TypertRemoteFailure` 抛出（网关 `rpcFailure` 原样放行 `.failure`），消费端按 `error.code` 判别、绝不解析消息文本。SDK wire face 把 zod 拒绝收拢为携带 zod issues 的 `durable/input-invalid`；引擎 `startRun`/`steerText` 边界把其余一切 wire-face 拒绝收拢进同一码并保留原消息，手写 face 的诊断因此活在稳定码之下。fixture 失败应答携带相同码、details 与引擎消息原文。sync 载入 `RemoteError` 后，`src/failures.ts` 成为该 map 的 `durable/*` 声明，仅载体类更换——码表与 details 不变。

## Consequences

wire 可达的引擎失败在消息改动之下保持稳定：十二个码覆盖每一条跨 Remote 边界的失败路径（`run-not-found` 同时服务 steer、steerText、rerun 与 cancel），每个码带类型化 details，消费端无需字符串解析即可行动。壳消费端在 fail-loud 错误里把码放在端点名旁，浏览器错误态因此展示稳定词汇。引擎 ledger 打开失败的消息保持原样（cause 仍只在进程内可见，与之前一致）。fixture 的定义歧义分支在种子名册下仍不可达，与词汇化之前的代码完全一致——名册设计上无重名。

## Alternatives considered

保留消息文本判别是被本票终结的现状：每次消费端重写、每次 sync 重放都在重新解析散文。在本树预造 fork 版 `RemoteError` 仿制品被否决：基类在此树不存在，fork 仿制品会与 sync 带来的类相撞——本票的存在正是为了让那次 sync 变便宜。在 fork 代码任何位置用 instanceof 判别被否决：上游之所以改用结构标记，正是因为模块身份跨 bundle 会失效；仅存的一处 instanceof 检查在上游 `rpcFailure` 内。

## Testing

`packages/daypaw/engine/tests/failure-vocabulary.spec.ts` 走完整个码表——每条 wire 可达路径断言码、details 与未改动的消息文本，含 ledger-unavailable。`packages/daypaw/sdk/tests/agents-dir.spec.ts` 钉住 zod issues details；`packages/daypaw/web-app/tests/wire-contract.spec.ts` 证明码跨真网关（其 `gatewayRpc` 助手现在镜像 `rpcFailure` 的放行，而非把业务失败压平为 `internal`）。`packages/client/connection/tests/fixture-durable.client.spec.ts` 钉住 fixture 应答；三个消费端 spec 钉住携带 `(code)` 的失败格式。
