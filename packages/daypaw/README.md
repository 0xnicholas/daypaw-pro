---
description: "The daypaw fork package group: durable execution engine, agent SDK, store, CLI, product-shell bundles, and approval history over the dee"
kind: "package-group"
---

# daypaw/ — fork product family

English | [中文](README.zh.md)

## Summary

The daypaw group is the fork's in-tree product family over the upstream deepseek-harness base (ADR 0001): the durable execution engine and its store contract, the code-first agent SDK, the self-contained CLI delivery, the product-shell bundles, and the approval-history host projection. The group's central subsystem page is [daypaw-engine](../../docs/subsystems/daypaw-engine.md); package-level contracts live in each package README.

## Packages

- [`engine/`](engine/README.md) — the durable execution engine (`@daypaw/engine`)
- [`store/`](store/README.md) — the neutral SQLite ledger contract (`@daypaw/store`)
- [`sdk/`](sdk/README.md) — the code-first agent SDK (`@daypaw/sdk`)
- [`cli/`](cli/README.md) — the self-contained CLI delivery (`@daypaw/cli`)
- [`approval-history/`](approval-history/README.md) — the approval audit projection host unit
- [`web-app/`](web-app/README.md) — the product-shell web bundle glue
- [`ui-*/`](ui-inbox/README.md) — the product-shell browser plugins

## Dev Note

The group is private (`@daypaw/*` 0.x) and follows the fork conventions in [docs/fork/adding-a-daypaw-package.md](../../docs/fork/adding-a-daypaw-package.md).
