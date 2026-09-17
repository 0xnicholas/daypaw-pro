---
description: "daypaw 浏览器平面对 durable 引擎 Remote 面的唯一 wire 词汇家：七个 durable/* 端点调用、手声明 wire 行类型与 fail-loud 解析、五值 run 状态词表及其 zh/en 文案"
kind: "package-reference"
---

# @daypaw/durable-client

[English](README.md) | 中文

## 概述

## 目录



daypaw 浏览器平面对 durable 引擎 Remote 面的唯一 wire 词汇家（[spec 05](../../../docs/spec/05-product-shell.md) §5，[票 #116](https://github.com/0xnicholas/daypaw-pro/issues/116)）：壳今日消费的七个 `durable/*` Remote 端点收在一个客户端 interface 之后，加上各面共享的 run 状态词表。四个 ui-* 包经本包读引擎、从不 import `@daypaw/engine`——端点字符串、`{ args }` 信封、snake_case 行解码、ok/error 解包在这里且只在这里。

- **客户端 face**（[`api.ts`](./src/client/api.ts)）：`createDurableClient(rpc)` 返回一个 `DurableClient`，含 `listRuns` / `runLineage` / `journalTimeline` / `rerun` / `listDefinitions` / `startRun` / `steerText`。结构化 `steer` 与 `cancel` 端点暂无浏览器消费者，待真消费者出现再加。
- **手声明 wire 类型**（[`wire.ts`](./src/client/wire.ts)）：行形状在此声明而非 alias 引擎类型——独立声明正是 wire 边界校验的对象，序列化漂移由 [`@daypaw/web-app`](../web-app/README.zh.md) wire-contract spec 的活网关执行测试兜底。浏览器读到的每个字段 fail-loud 校验（错构建、冒牌端点即炸）；需要容错的消费方在自己的调用侧降级，绝不由削弱解析器实现。
- **状态词表**（[`status.ts`](./src/client/status.ts)、[`locales.ts`](./src/client/locales.ts)）：五值 run 状态 union、`isUnfinishedWireRun`、自持 `'durable'` namespace 的 zh/en 状态文案——状态文本在各面之间不再分叉。各面经绑定的 `ctx.locale.bind('durable')` 翻译函数加 `runStatusKey` 渲染。
- **插件半边**（[`index.ts`](./src/client/index.ts)）：唯一效果——注册 `'durable'` 词典。node 半边无行为；库本体经连接的通用 RPC 通道直接消费。

## Model Experience

### Durable wire 词汇

#### 模型看到什么

无。本包承载浏览器的 `durable/*` RPC 载荷与 `'durable'` locale 词典；不存在 prompt、工具或 schema 面，任何 wire 行都不进模型请求。

#### Token 效果

零 live-request token。

#### KV Cache 效果

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **`steer` 与 `cancel` 未收。** 结构化 steer 与 cancel 端点暂无浏览器消费者；真消费者出现时并入本 face（YAGNI，票 #116 裁决 2）。
- **血缘成员只在出现时校验。** `runLineage` 把 `null` 的 run/parent 成员读作缺席，对齐引擎的 wire-safe 形状；未知 runId 是调用方的呈现条件，不是解析失败。
- **无 `/testing` 子路径。** 消费方 fake 直接实现 `DurableClient`；等三个包重复出同一 fake 再抽共享模块（票 #116 裁决 6）。

### 开发备注

**Runtime invariant:** No companion is published. 本包唯一可观测关系——端点字符串、信封与行解码匹配引擎 Remote 面——由 `@daypaw/web-app` 的活网关 wire-contract spec 断言；独立观测不可能偏离该执行已证明的事实，故不设 `./invariant` 伴生物。
