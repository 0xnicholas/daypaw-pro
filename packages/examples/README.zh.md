---
description: "examples 包组：跑得起来的演示，基于上游基座与 daypaw 引擎。"
kind: "package-group"
---

# examples/ — 跑得起来的演示

[English](README.md) | 中文

## 概要

examples 包组收的是跑得起来的演示，而不是产品接口：每个包都引导一个可以端到端执行的真实组合。包组的子系统锚点是 [daypaw-engine](../../docs/subsystems/daypaw-engine.zh.md)，即这些演示所驱动的持久执行引擎。本包组不含应用入口；出厂 profile 在 [`bundle/`](../bundle/README.zh.md) 下。

## 包清单

- [`daypaw-skeleton/`](daypaw-skeleton/README.zh.md) — daypaw 走骨架：可扛住真实 `SIGKILL` 的三步持久工作流，加支柱②的 agent 编译面（`@daypaw/daypaw-skeleton`）
