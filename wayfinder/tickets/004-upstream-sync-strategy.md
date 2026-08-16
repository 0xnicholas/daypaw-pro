---
title: "上游同步策略与 fork 卫生"
type: grilling
status: open
assignee:
blocked-by: []
---

## Question

daypaw-pro 作为 dsh 的 fork + in-tree 扩展，与上游（dev-preview、周级提交、承诺 breaking changes）的同步策略是什么？要敲定：合并节奏（跟随每次 release？定期 rebase？择机合并）；四支柱代码如何组织才能把 merge 冲突面压到最小（独立 packages 目录 vs 触碰 core 的改动如何隔离/上游回赠）；包命名与版本策略（`@daypaw/*` 还是沿用 `@deepseek-ai/dsh-*`；fork 版本号如何映射上游）；哪些情况下允许直接改 core（vs 必须走 seam）；`cordis.patch.yml`/profile 层在 fork 中的角色；vendor/ 目录与 patches/ 的既有机制要不要利用。产出 ADR：上游同步策略。
