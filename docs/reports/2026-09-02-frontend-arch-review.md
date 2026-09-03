# daypaw 前端架构复盘报告

> 日期：2026-09-02。快照性质：[daypaw 前端架构复盘：复用边界与路线 B 评估](https://github.com/0xnicholas/daypaw-pro/issues/77)（七票全闭）的收官报告——产品壳落地（#54–#76）后的首次架构评估。事实各归其家——决策见各票 resolution 与 [docs/adr/](../adr/)，规格见 [docs/spec/05-product-shell.md](../spec/05-product-shell.md)，词汇见根 [CONTEXT.md](../../CONTEXT.md)；本文只做综合与导览，不另立事实。并行事件：本图进行期间发生了一次产品定位重审（[map #95](https://github.com/0xnicholas/daypaw-pro/issues/95)，[ADR 0013](../adr/0013-positioning-review-dual-mode.md) 双模式分层），见 §7。

## 1. 结论摘要

- **路线 B 维持**（[#82](https://github.com/0xnicholas/daypaw-pro/issues/82)）：fork 自有 profile 托管自有 dist、随 `@daypaw/cli` 自含交付，经 648 提交上游漂移 + 全量债审计后无一架构前提被侵蚀。成本可陈述、可收敛：fixture.ts 一处高摩擦（已有 spike 收敛路径）+ 聚合行机械重放。
- **复用边界全簇维持、零返工**（[#80](https://github.com/0xnicholas/daypaw-pro/issues/80)）：上游漂移**零替代物、零贬值**，复用内核原位升值（connection 恢复硬化、ui-chat/ui-conversation 流式提速白拿）。
- **债收敛于一处**（[#81](https://github.com/0xnicholas/daypaw-pro/issues/81)）：fixture.ts ~600+ 行是唯一高摩擦项；后端缝隙三面（网关 Remote / 会话投影 / agents 目录装载）零上游编辑；登记簿机制经 2026-08-28 sync 实证有效（#64 行消解）。
- **功能走查**（[#84](https://github.com/0xnicholas/daypaw-pro/issues/84)）：设置、目录、发起 run 真网关、完成后历史 ✅；核心闭环断点一处（运行中对话不可达，#94 修复票），两个产品级缺口移交定位重审图并已裁决（轻对话接回 #102、审批空转根治 #103）。

## 2. 现状盘点（评估对象）

产品壳四板块 + 自跑交付全量落地（#54–#76）：`apps/daypaw-web`（vite 入口，78 LOC）+ `@daypaw/web-app`（胶水 bundle，路线 B 托管层）+ 自营 UI 家族（ui-inbox 1502 / ui-tasks 1433 / ui-settings 1118 / ui-agents 423 / ui-brand 183 / approval-history host 包）；五条 golden 免 key 回放车道 + assembled-boot 冒烟骑上游 connection fixture（#56/#72）；壳发起 run 走真网关 wire（#67，#75 修复后经真网关验证）；agents 目录装载 + ledger 同域（ADR 0012）；发布 tarball 闭包 + `dev:daypaw` 源码态入口（#69/#70/#76）。

## 3. 漂移评估（[#78](https://github.com/0xnicholas/daypaw-pro/issues/78)）

漂移窗 `cd5ef81481`（= `daypaw-sync/2026-08-28`）→ `4e84901e64`，648 提交 / 4 天（client 栈 171）；上游正处高频演化期（4 天 3 alpha）。核心判定：

- **零替代物**：收件箱任务中心、审批待办中心、agents 目录、壳发起 run 均为 fork 独有面，上游同域包形态未变。
- **复用内核原位升值**：connection 恢复硬化浪潮（`ConnectionStateSource`/`ConnectionLoop` 出口）、ui-chat/ui-conversation 流式性能浪潮——消费端白拿。
- **重放成本集中三个交叉点**：fixture.ts × 三条横切重构（session seq/offset 分离 351 文件、Remote 失败词汇收敛、跨包 relay 删除）；repo 级 stylesheet-scan（下次 sync 起直接扫 fork CSS）；`@daypaw/*/invariant` 伴生物与上游反模式口径的约定漂移。
- **底册校准**：#37 清单包名早于上游 2026-08-28 重组（runtime → store/ui-conversation/ui-chat/ui-renderer），裁决记录已迁移现行包名（#89）。

findings：`docs/research/2026-09-02-upstream-drift-client-stack.md`（分支 `research/upstream-drift-client-stack`）。

## 4. 债评估（[#79](https://github.com/0xnicholas/daypaw-pro/issues/79)）

- **头号债 = fixture.ts durable/\* 应答**（~600+ 行 fork 代码住上游测试运输文件）：引擎契约三处镜像义务（engine Remote → SDK wire → fixture），#75 实证 fixture 绿 ≠ 真网关绿。反转路径具体：装饰器 transport 迁移（`createFixtureConnectionRpc` 公开窄接口），spike 第一问 = 能否驱动 startRun 会话孪生（#90）；fx 种子调整不可迁移，继续小块保留登记。
- **卫生两件**：未登记的 `fixture-durable.client.spec.ts`（迁 `apps/daypaw-web/tests/`）；built-boot 登记路径过期（上游改名后没跟）——#91 一并修 + 登记簿全量校验。
- **低摩擦 8 条保留登记**：coverage 豁免 glob（ADR 0007 机械化）、client-tsconfig 枚举、tsconfig 三件、knip、脚本行、gitignore；不为聚合行建生成器。
- **ui-theme `DEFAULT_PREFERENCE`→light 保留**：不可能链已证（settings namespace 归属注册不可重叠 / 插件无 config 钮 / 种子污染共享文档，ADR 0001 §4 三问无解）。
- **后端缝隙三面零上游编辑**：durable/\* 挂 Typert 网关现成缝（GoalService 先例）、approval-history 挂上游投影缝、agents-dir 纯函数装载——路线 B 的架构成本不在缝隙面。

findings：`docs/research/2026-09-02-frontend-arch-debt-audit.md`（分支 `research/frontend-arch-debt-audit`）。

## 5. 功能走查（[#84](https://github.com/0xnicholas/daypaw-pro/issues/84)）

`dev:daypaw` 真壳真 key 实走。正常项：设置单面页四分区 / agent 目录 / 发起 run 真网关（run 真实执行至 done，#75 修复有效）/ run 完成后对话历史（孪生会话 274 事件完整落盘）。缺口：

1. **缺口①（高，实现缺失）**：任务**运行中**对话不可达——孪生会话未及时进浏览器 sessions 列表，任务行降级裸 run、只剩右栏详情；追问位（运行中 steer / 空闲续聊，代码已实现）无处出现。核心闭环「发任务 → 看 agent 干活 → 追问」断在运行中一跳 → 修复票 [#94](https://github.com/0xnicholas/daypaw-pro/issues/94)（须真网关验证）。
2. **缺口②（产品裁决）**：无普通会话入口 → 移交定位重审图，裁「接回」（[#98](https://github.com/0xnicholas/daypaw-pro/issues/98) → 执行票 [#102](https://github.com/0xnicholas/daypaw-pro/issues/102)）。
3. **缺口③（触发面缺失）**：审批待办长期空转——工具行全禁使敏感操作不存在 → 定位重审裁工具套件全开根治（[#100](https://github.com/0xnicholas/daypaw-pro/issues/100) → [#103](https://github.com/0xnicholas/daypaw-pro/issues/103)，审批护栏维持）。

未验证：重试 rerun（无失败样本）、审批即时卡（无触发面，#103 后可补验）。

## 6. 裁决与执行票清单

裁决详情见各票 resolution；图 #77 的 Decisions so far 为索引。执行票（图外，全部 `ready-for-agent`）：

| 票 | 内容 | 来源 |
|---|---|---|
| [#86](https://github.com/0xnicholas/daypaw-pro/issues/86) | durable/\* Remote 失败词汇对齐上游 gateway/\* | #80（sync 前置） |
| [#87](https://github.com/0xnicholas/daypaw-pro/issues/87) | `@daypaw/*/invariant` 伴生物按上游口径审计 | #80 |
| [#88](https://github.com/0xnicholas/daypaw-pro/issues/88) | stylesheet-scan 预检：上游规则预扫 fork CSS | #80（sync 前置） |
| [#89](https://github.com/0xnicholas/daypaw-pro/issues/89) | 裁决记录迁移现行包名（CORE_TOUCHES + spec 05 §4） | #80 |
| [#90](https://github.com/0xnicholas/daypaw-pro/issues/90) | spike：durable/\* fixture 应答迁装饰器 transport | #81 |
| [#91](https://github.com/0xnicholas/daypaw-pro/issues/91) | 登记簿卫生：spec 迁移 + 路径修正 + 全量校验 | #81 |
| [#92](https://github.com/0xnicholas/daypaw-pro/issues/92) | 接入 session-turn-outline（随下次 sync） | #85 |
| [#93](https://github.com/0xnicholas/daypaw-pro/issues/93) | 连接恢复指示器业务语言移植 | #85 |
| [#94](https://github.com/0xnicholas/daypaw-pro/issues/94) | 修复：任务运行中对话不可达 | #84 |

**同步策略修正**（#82）：下次 sync 前先落 #86 + #88（硬成本，merge 后不致一片红）；#90 并行不阻塞；#87/#91/#92/#93 随时。

## 7. 并行事件：产品定位重审

本图走查期间，「为什么不基于 dsh 前端改造/复制表现层/用上已开发功能」的三连问触发了一次定位重审，独立成图（[map #95](https://github.com/0xnicholas/daypaw-pro/issues/95)）并已收官：使用证据（10 天 3 run、owner 日常对话在壳外、零客户信号）+ 面清单（真轴在能力底座）→ **双模式分层**（[ADR 0013](../adr/0013-positioning-review-dual-mode.md)）：技术用户全能力面（工具套件全开 #103、trajectory 高级视图 #105、roster 两行 #104），业务语言壳为默认皮肤；轻对话接回（#102）；spec 05 已修订。本报告的缺口②③处置与执行票 #102–#105 即其产物。

## 8. 方法与边界

两份 findings 均一手证据（上游 git 对象 sha 内联 / 本仓文件路径引用）；走查为单机单操作者真跑（非全面 QA）；漂移盘点基于提交主题 + 关键 diff 抽读，未逐行审读全部 648 提交。本报告覆盖架构与复用边界 + 功能走查；UX 兑现度、测试质量方法论、过程复盘经画图裁决留图外。
