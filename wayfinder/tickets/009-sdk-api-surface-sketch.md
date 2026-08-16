---
title: "SDK API 表面草图"
type: prototype
status: open
assignee:
blocked-by: [6]
---

## Question

把「Engine 与 SDK 编程模型边界」敲定的词汇表做成一个可动手的粗稿：`@daypaw/sdk` 的 `.d.ts` 级 API 草案 + 若干端到端示例（code-reviewer pipeline、含 human-gate 的审批流、崩溃恢复演示的伪代码），作为 spec 第 2 章的具象反应用品。粗稿要暴露尖锐边角：类型如何表达 step 间数据流、错误与重试在类型层的呈现、tool 定义的复用（能否直接复用 dsh tool 包）。产出原型代码/类型草案链接（throwaway，不进 main 的 src）。
