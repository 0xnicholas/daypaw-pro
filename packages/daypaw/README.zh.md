---
description: "daypaw fork 包组：基于 deepseek-harness 基座的 durable 执行引擎、agent SDK、store、CLI、产品壳 bundle 与审批历史。"
kind: "package-group"
---

# daypaw/ — fork 产品家族

[English](README.md) | 中文

## Summary

daypaw 组是 fork 基于上游 deepseek-harness 基座（ADR 0001）的树内产品家族：durable 执行引擎及其 store 契约、代码优先 agent SDK、自含 CLI 交付、产品壳 bundle，以及审批历史 host 投影。组的核心子系统页是 [daypaw-engine](../../docs/subsystems/daypaw-engine.zh.md)；包级契约在各包 README。

## Packages

- [`engine/`](engine/README.zh.md) — durable 执行引擎（`@daypaw/engine`）
- [`store/`](store/README.zh.md) — 中立 SQLite ledger 契约（`@daypaw/store`）
- [`sdk/`](sdk/README.zh.md) — 代码优先 agent SDK（`@daypaw/sdk`）
- [`cli/`](cli/README.zh.md) — 自含 CLI 交付（`@daypaw/cli`）
- [`approval-history/`](approval-history/README.zh.md) — 审批审计投影 host 单元
- [`web-app/`](web-app/README.zh.md) — 产品壳 web bundle 胶水
- [`ui-*/`](ui-inbox/README.zh.md) — 产品壳浏览器插件

## Dev Note

该组为私有（`@daypaw/*` 0.x），遵循 [docs/fork/adding-a-daypaw-package.md](../../docs/fork/adding-a-daypaw-package.md) 中的 fork 约定。
