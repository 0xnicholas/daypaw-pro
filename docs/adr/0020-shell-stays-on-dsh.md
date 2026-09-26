# ADR 0020: 产品壳留在 dsh——换轴的触发条件

- **状态**：已接受（2026-09-26，[产品壳留在 dsh：换轴的触发条件](https://github.com/0xnicholas/daypaw-pro/issues/155)）
- **前置**：ADR 0019（冻结姿态）；ADR 0011（客户自跑交付）；ADR 0001 §4（core 触碰三问，重放义务由 ADR 0019 作废、三问保留）；[dsh-free spike 报告](../research/2026-09-26-dsh-free-spike.md)
- **事实底座**：dsh-free spike（2026-09-26）实测引擎侧离开 dsh 成立——适配层 90 行（对照今日 dsh 绑定面 `packages/daypaw/sdk/src/agent.ts` 478 行）、真 `kill -9` 跨进程续跑成立、新引入概念 0。壳侧相反：`packages/daypaw/ui-*` 五个包 4,679 行 src 加上 `durable-client`、`client-load`、`web-app`、`approval-history`、`assembled-boot` 合计约 6.2k 行 src 与约 7.4k 行测试，全部建立在 dsh 客户端插件系统（slot 环、locale、renderer、primitives、remote wire）之上，`ui-inbox` 单包 import 15 个 `@deepseek-ai/*`、`ui-tasks` 13 个。ADR 0019 冻结上游后，客户端面上需要改上游行为的条目只剩一条 1 行常量（`packages/client/ui-theme` 默认亮色）。

## 决策

### 1. 壳留在 dsh，不启动重写

引擎的独立宿主能力（spike 已验证）作为选项保留。产品壳继续用 dsh 的浏览器面；引擎继续以 `ctx.durable` 插进 dsh 宿主。

### 2. 换轴复议的触发条件

任一条件命中即开一次评估（评估不是换轴执行）：

1. 出现一项产品能力，ADR 0001 §4 的三问（新包 + seam 表达 / `cordis.patch.yml` 覆盖 / merge-extensible 事件）全部否决，且必须改上游源面才能交付；
2. 冻结姿态失效：某个上游变更成为不可绕过的阻断（例如模型 provider 适配层需要多包协同重写，cherry-pick 不可行）；
3. 分发形态（ADR 0011）与客户端插件系统的耦合使交付无法完成。

### 3. 复议的既定起点

复议从 [spike 报告](../research/2026-09-26-dsh-free-spike.md) §2 的实测数字与本文 §4 的触发记录开始，不重做 spike；壳侧的成本按本文事实底座的两组行数计。

### 4. 触发记录

每命中一次触发条件，在此追加一行：日期、条件编号、被测能力、结论。

## 考虑过的替代方案

**现在开始重写壳**：拒绝。5.6k 行以上 src、7.4k 行以上测试，并要自建 slot 环、locale、primitives、主题与 remote wire；这是用确定的大成本换尚未出现的收益。ADR 0019 已移除 75.3% 的仪式成本，那才是「dsh 让事情变复杂」的实测来源。

**立刻切混合形态（壳留 dsh、引擎走出去）**：拒绝。引擎当前的唯一消费者就是这个壳，分居两套世界只让产物形态分裂，没有一方从中受益。

**不记录触发条件，保持隐含**：拒绝。触发条件不写下来就无从判定，「什么时候该复议」会退化成情绪，而情绪正是这次复盘要修的东西。

## 后果

- 产品线恢复：冻结红利（提交构成里不再有同步类工作）立刻可用于壳与引擎的功能工作。
- 换轴成本被量化并留存：壳侧重写约 6.2k 行 src + 7.4k 行测试 + 自建客户端底座；引擎侧约 90 行适配层。
- 新增一条维护动作：命中触发条件时在 §4 追加记录行。
