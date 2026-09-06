---
description: "The examples package group: runnable demonstrations over the upstream base and the daypaw engine."
kind: "package-group"
---

# examples/ — runnable demonstrations

English | [中文](README.zh.md)

## Summary

The examples group holds runnable demonstrations rather than product interfaces: each package boots a real composition a person can execute end to end. The group's subsystem anchor is [daypaw-engine](../../docs/subsystems/daypaw-engine.md), the durable execution engine the demonstrations exercise. This group contains no application entrypoint; shipped profiles live under [`bundle/`](../bundle/README.md).

## Packages

- [`daypaw-skeleton/`](daypaw-skeleton/README.md) — the daypaw walking skeleton: a three-step durable workflow surviving a real `SIGKILL`, plus the pillar-② agent compilation face (`@daypaw/daypaw-skeleton`)
