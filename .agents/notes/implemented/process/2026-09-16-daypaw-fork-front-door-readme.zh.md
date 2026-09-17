# Agent Note: daypaw fork 前门 README 作为 fork 自有根文件

Status: implemented

[English](2026-09-16-daypaw-fork-front-door-readme.md) | 中文

## 问题

仓库在 GitHub 上的前门是 `README.md`——一份上游所有的双语配对文件，只介绍 DeepSeek Harness。fork 的访客从中读不到任何 daypaw 信息；真正描述 daypaw 的 fork 语料（`CONTEXT.md`、`docs/adr/`、`docs/spec/`、`docs/fork/`）中文优先，且没有任何从前门可见的入口。`AGENTS.md` fork 层注记带有指针，但面向编码 agent，不面向人类访客。

## 决策

- fork 前门是 `README-daypaw.md`——新的 fork 自有、中文单语根文件：定位陈述、包族速览表、fork 与上游的关系、经核验的快速上手命令与导览链接。它不复述词汇表、ADR 或 spec 的内容——每个事实留在原家，本页只做链接。
- 该文件按构造就处于所有文档门之外。配对门的发现只匹配整个词干为 `readme` 的 README 工件（[scripts/translation-pairing.ts](../../../../scripts/translation-pairing.ts) 的 `README_ARTIFACT`；范围规则归[双语文档配对门](2026-07-02-bilingual-docs-and-pairing-gate.zh.md)所有），因此 `README-daypaw.md` 无需 manifest 排除即落在配对范围外，不新增 core-touch，也没有词数上限。
- 可发现性搭载已登记的 `AGENTS.md` fork 层 core-touch：fork 层注记增加 `README-daypaw.md` 指针，`docs/fork/CORE_TOUCHES.md` 的 `AGENTS.md` 行如实登记该扩展。
- 页面陈述的每条命令与默认值都对照检出内容核验过（`scripts/dev-daypaw.sh`、根 `package.json`）；页面不声称任何未从这些来源读到的东西。

## 备选方案

- **在根 `README.md` 文末追加 fork 节** —— 否决：这会 core-touch 上游改动频率最高的文件，且背负配对义务（EN、ZH、sidecar 必须同步动），每次同步仪式都要在 fork 并不拥有的营销文案上重放三文件冲突。
- **以 `docs/fork/README.md` 为入口** —— 作为前门否决：docs 树从仓库落地页不可见，且 `docs/spec/README.md` 已在语料内承担索引角色；新建根文件成本相同，且可从仓库根目录清单到达。
- **如 `packages/daypaw/README.md` 那样的双语 EN/ZH 配对** —— 否决：fork 设计语料按 wayfinder map #1 中文优先，当前读者（owner 与编码 agent）读中文；为一个事实都在别处的页面做配对，买来的是对齐维护成本。
- **正文写成完整架构概览** —— 否决：会复制 `CONTEXT.md`、ADR 与 spec 的内容，违反一事一家，首次同步即腐烂。

## 后果

- fork 获得一个可维护的入口页，唯一同步暴露面是自身事实过期；没有上游文件能与它冲突。
- 处于门之外是双刃剑：没有上限或配对检查守护该文件，准确性是评审责任。命名是承重的：把这份内容移进任何词干恰为 `readme` 的文件（目录级 `README.md` 或 `README.zh.md`）会静默进入配对范围，届时需要 manifest 排除。
- 上游同步与包族增长是重查本页命令与包表的时刻。
