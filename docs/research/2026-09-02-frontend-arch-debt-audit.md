# daypaw 前端架构债审计：core-touch 归因与后端缝隙面现状

> Wayfinder 研究票 [#79 「前端架构债审计：core-touch 归因与后端缝隙面现状」](https://github.com/0xnicholas/daypaw-pro/issues/79) 的成果，隶属地图 [#77 「daypaw 前端架构复盘：复用边界与路线 B 评估」](https://github.com/0xnicholas/daypaw-pro/issues/77)。日期：2026-09-02。调查对象：**本仓库当前树**（main @ `dd6fae8380`）。本地审计：一手来源为登记文件本身、daypaw 包源码、ADR 与 spec，引用一律为仓库内路径。结论喂给「core-touch 债处置裁决」票（#81）与「路线 B 存续总裁决」票（#82）。

## 0. 审计口径

- **前端可归因** = 产品壳落地（#54–#76）引入或显著增长的 [docs/fork/CORE_TOUCHES.md](../../fork/CORE_TOUCHES.md) 条目 + 未登记但同源的树内痕迹。纯引擎侧（store/engine/sdk 走骨批次）不在本表，见登记簿全表（27 行表格中数据行约 22）。
- **处置三选**：保留登记（理由 + 重放成本）/ 反转为 fork 自有缝（形状与代价）/ 上游 PR 候选（提案形状）。
- 每条给「债的形状 + 每次 sync 的重放成本 + 三选证据」；裁决建议供 #81 采信，不代替裁决。

## 1. 总览

| 条目 | 债形状 | sync 重放成本 | 审计建议 |
|---|---|---|---|
| [packages/client/connection/src/client/fixture.ts](../../../packages/client/connection/src/client/fixture.ts) durable/* 应答 | ~600+ 行 fork 代码住上游测试运输文件；引擎契约的第三处镜像 | **高**（上游重构 fixture 即手工重放；#75 实证 fixture 绿 ≠ 真网关绿） | 立装饰器迁移 spike（图外执行票）；迁移前保留登记 |
| packages/client/connection/tests/fixture-durable.client.spec.ts | **未登记**：fork 自有文件住上游包 tests/ | 静默漂移（新增文件不进 merge 冲突） | 迁到 apps/daypaw-web/tests/（与车道同 owner）或补登记 |
| built-boot 断言（apps/web/tests/built-boot.expected.e2e.ts:94） | **登记路径过期**：登记簿仍写 `built-boot.snapshot.ts` | 重放时按登记找不到文件 | 修登记行；执行票顺带全量校验登记簿路径 |
| ui-theme `DEFAULT_PREFERENCE`→light | 唯一改上游**产品行为**的触碰；涟漪面已登记 | 低而稳定（一行常量 + 固定涟漪） | 保留登记，不动 |
| vitest.config.ts coverage 豁免 glob | ADR 0007 §1 裁决的机械化 | 低（一行 glob） | 保留登记 |
| scripts/client-tsconfig.spec.ts 枚举 `'daypaw'` | 测试内枚举值 | 低 | 保留登记 |
| tsconfig.base/host/client.json 聚合行 | 加性路径/引用行，行数随板块追加（client 已 4 次追加） | 低-中（冲突时按行重加） | 保留登记；不建清单生成器（机械成本低于建制的复杂度） |
| knip.json 条目 | 加性豁免/entry 行，6 次追加 | 低 | 保留登记 |
| root package.json 脚本行（test:web:daypaw 族、build:web 扩展） | 加性脚本 | 低 | 保留登记 |
| .gitignore（apps/daypaw-web/dist、/daypaw/） | 加性忽略 | 低 | 保留登记（#73 根锚定防误吞 packages/daypaw/，正确） |

后端缝隙面（§3）结论先行：**三面（网关 Remote / 会话投影 / agents 目录装载）都是「fork 包挂上游缝、零上游编辑」**，上游编辑集中在测试运输一个文件。路线 B 的架构成本主要 = fixture.ts + 聚合行机械重放。

## 2. 逐条审计

### 2.1 fixture.ts 的 durable/* 应答（头号债）

**形状**。fork 在上游免 key 测试运输里持有：模块级可变表三张（`fixtureRuns` [1892–1979 行]、`fixtureJournal` [1980–2031]、定义表 [2207 起]）、`appendFixtureRerun`/`nextFixtureStart`（[2040 起]）、rpc switch 六个 `durable/*` 臂（[3794–3910]）、`durable/startRun` 的会话孪生驱动（直调内部 `sessionApi.prompt` 与 `emitRemote('api-session/added')`，[3802–3860]）、以及上游世界的种子调整（fx-alpha 日志的 approval asked/decided 对与 turn-75 todo_write 样本 [~920–1000]、fx-gamma 常驻 question、`FixtureOptions.flipGammaRunning` 选项、approvalHistory 折叠进 projectionValuesOf/projectionFramesOf）。合计约 600+ 行。fixture 经 [src/client/index.ts](../../../packages/client/connection/src/client/index.ts) 公开导出 `createFixtureConnectionRpc`（fixture.ts:4053），boot 以 `?fixture` 查询串选用（[apps/daypaw-web/tests/assembled-boot.ts:251](../../../apps/daypaw-web/tests/assembled-boot.ts)）。

**存在理由**：五条 golden 车道（apps/daypaw-web/tests/*.golden.ts）免 key 起整壳，浏览器 fixture 必须应答 fork 私有端点——「`goals/*` 先例」（登记行原文）。

**重放成本**：
- 上游重构 fixture 时整块手工重放。上游对该文件并不安静：connection 面在 fork 历史里已有两轮重构（`e036aae7c0`、`e14d354e83`）；上游测试文件也改过名（§2.3）。checkpoint `daypaw-sync/2026-08-28` 后本文件 +91/−5（#67 startRun + #75 修复）。
- **镜像义务**：durable 契约每变一次要同步三处（引擎 `@Remote` 面 → SDK wire face → fixture），且 **#75 实证 fixture 绿灯不证明真网关绿**（startRun 具名参数 `request` 嵌套只在真网关炸——该修复提交信息原文「wire 契约上真网关验证」）。历史上另有 #58 落地后上游 todo-row 快照红（`65c0701834`）、fx-gamma 翻转与列表采样竞态改 `FixtureOptions.flipGammaRunning`——fixture 语义追赶产品断言已是第三次。

**三选证据**：
- **保留登记**：零迁移成本；但表只增不减，冲突面随行数涨，镜像义务无解。
- **反转为 fork 自有缝（部分可行，建议方向）**：`createFixtureConnectionRpc` 是包公开导出，返回窄接口 `ClientConnectionRpc`——fork 可在 `apps/daypaw-web/tests/`（或测试包）持**装饰器 transport**：包一层 `call()`，拦 `durable/*` 臂 + 自持 run/journal/definition 表，其余透传。可迁移面：六臂 + 三张表 + startRun 的注册表解析/去歧义/attempt 追加。**硬点**：startRun 孪生驱动直用 fixture 内部 `sessionApi.prompt`/`emitRemote`，装饰器够不着——需确认公开面是否足以驱动孪生（spike 票的第一问）。**不可迁移面（诚实边界）**：fx-alpha/fx-gamma 种子调整改的是 fixture *世界*的内部种子表，不在 rpc switch 上；出路是继续小块保留登记，或上游世界种子可注入化（`flipGammaRunning` 本身就是 fork 撑开的上游缝，说明该缝正被渐进打开）。
- **上游 PR 候选**：无——端点不存在于上游，无提案可提。

### 2.2 未登记：fixture-durable.client.spec.ts

[packages/client/connection/tests/fixture-durable.client.spec.ts](../../../packages/client/connection/tests/fixture-durable.client.spec.ts)（checkpoint 后新增，+50 行）：fork 自有测试文件住在上游包的 tests/ 目录，CORE_TOUCHES.md 无对应行。债不在代码在**可见性**：新增文件不进 merge 冲突，上游改 tests/ 约定（含改名——见 §2.3 的先例）时静默漂移；且「上游树内 fork 文件」违背登记簿的可见性承诺。建议**迁到 `apps/daypaw-web/tests/`**（它测的就是 daypaw golden 的供数源，与车道同 owner；上游树恢复零 fork 痕迹），不愿迁则补登记一行。

### 2.3 登记路径过期：built-boot 断言

登记行写 `apps/web/tests/built-boot.snapshot.ts`，实际文件现为 [apps/web/tests/built-boot.expected.e2e.ts](../../../apps/web/tests/built-boot.expected.e2e.ts)（94 行 `Waiting for approval`）——上游改名后 fork 编辑随内容存活，登记行没跟。重放时按登记路径找不到文件，登记簿自身腐化。建议修路径，并**全量校验登记簿各行路径时效**（本次抽查仅此一处过期）。

### 2.4 ui-theme DEFAULT_PREFERENCE→light

唯一改上游产品行为的触碰（其余都是测试/配置面）。反转不可能的证明链已在登记行：settings namespace 归属注册不可重叠 + 插件无 config 钮 + 种子 settings.yaml 污染与 dsh 共享文档 → ADR 0001 §4 三问无解 → 常量是唯一落点。上游 PR：否（产品决策；上游 dev 工具默认 system 自洽——spec 05 §7 裁决）。涟漪面固定且已登记（settings-store、5 个测试、README 双语、apps/web golden）。**裁决建议：保留登记，不动**；已知接受的影响面 = 上游 dsh web 壳默认连带变亮（TUI 无此插件）。

### 2.5 vitest.config.ts coverage 豁免 glob

ADR 0007 §1 裁决的机械化（[vitest.config.ts:246–250](../../../vitest.config.ts)，ui-* 家族沿用上游 client UI 的 GUI 债豁免姿态，注释就地引用登记簿）。反转 = fork 自持 vitest 配置 → 复制整份根配置双份维护，劣于一行 glob。上游 PR：glob 内容 fork 专属无门，豁免机制上游本有。**保留登记**。

### 2.6 client-tsconfig 枚举 + tsconfig 三件 + knip.json

全是加性聚合行/枚举值（[scripts/client-tsconfig.spec.ts:12](../../../scripts/client-tsconfig.spec.ts) 的 `'daypaw'`；tsconfig.base/host/client 与 knip.json 的逐包行）。机械重放，冲突时按行重加。结构性注记一条：`@daypaw/*/client`、`@daypaw/*/types` 两条 tsconfig.base 通配是 fork 自有源面解析约定，上游改 paths 布局时需跟着重推。**保留登记**；不为「成对增长的 css-modules include 行」建清单生成器——机械成本低于建制复杂度。

### 2.7 root package.json 脚本行 + .gitignore

加性、低摩擦、无行为涟漪。**保留登记**。

## 3. 后端缝隙面现状

### 3.1 durable/* Remote 面：干净，网关零上游编辑

[packages/daypaw/engine/src/index.ts](../../../packages/daypaw/engine/src/index.ts)：`DurableEngine extends TypertRemoteService`（`@deepseek-ai/dsh-typert-protocol`），`@Remote('listRuns' | 'runLineage' | 'journalTimeline' | 'listDefinitions' | 'startRun' | 'steer' | 'rerun' | 'cancel')` 八端点，服务名 `'durable'`。类注释载明关键架构事实：**「the TypertRemoteService binding lets the API gateway claim `durable/listDefinitions` (spec 05 §5; the GoalService precedent) without any upstream apiproxy edit」**——上游 typert 网关是现成可挂缝。耦合点仅上游 protocol 包的装饰器/基类 API（版本锁定，sync 时可见漂移）。

对照 spec 05 §5 兑现度：四项引擎增量（JournalStore 查询面 / 注册表只读视图 / defineAgent 展示字段 / steer 通道）+ startRun 全落地；`ctx.waitFor` gate 原语按裁决缓做（引擎票 #47，图外）；v1 审批待办确实只用上游交互式审批面——「等待你确认」分组供数走 pending 交互聚合（[packages/daypaw/ui-inbox/src/client/task-projection.ts](../../../packages/daypaw/ui-inbox/src/client/task-projection.ts) `awaitsApproval` 查 effective pending interaction kind），未造 fork 私有 pending 查询。无私货。

### 3.2 JournalStore 查询面：单一事实源成立

[packages/daypaw/store](../../../packages/daypaw/store)（SqliteJournalStore + migrations + `SCHEMA_VERSION`）+ [packages/daypaw/engine/src/seams.ts](../../../packages/daypaw/engine/src/seams.ts)（RunListFilter/RunInsert/RunFinalize 等接口）——查询知识收在引擎 seam，host 无 SQL 散点（spec 05 §5 裁决兑现）。浏览器侧 [packages/daypaw/ui-inbox/src/client/runs-api.ts](../../../packages/daypaw/ui-inbox/src/client/runs-api.ts) 在 wire 边界逐字段校验：malformed answer（错版本、冒牌端点）fails loud 进板错误态而非画出坏收件箱；snake_case→camelCase 投影归该模块自持。

### 3.3 host 轮询投影：浏览器轮询 + 会话投影两源

- **run 面**：`RunsBoardStore` 定时轮询 `durable/listRuns`（[runs-store.ts](../../../packages/daypaw/ui-inbox/src/client/runs-store.ts)：`intervalMs` 经 WebBootEntry 下发、`setIntervalFn` 可注入供测试）；引擎侧 `pollMs` 默认 1s（engine Config）。
- **会话/审批面**：[packages/daypaw/approval-history](../../../packages/daypaw/approval-history) 是 `ctx.sessionProjections` 单元（上游投影缝 `dsh-session-projection` 的 `ProjectionDefinition`），纯折叠 `approval/asked`+`approval/decided` 对——fork 包挂上游缝，零上游编辑。
- 两源合并在 task-projection.ts 完成，run-less session 也有分组路径——即 spec §5「host 轮询引擎查询面 + sessionProjections/mux 投影」的落地形状。

### 3.4 agents 目录装载（ADR 0012）：依赖方向干净

`loadAgentFiles(ctx, dir)` 纯函数住在 [packages/daypaw/sdk/src/agents-dir.ts](../../../packages/daypaw/sdk/src/agents-dir.ts)；组合在 [packages/daypaw/web-app/src/index.ts](../../../packages/daypaw/web-app/src/index.ts)（`agentsDir` 默认 `daypaw/agents`，`ctx.inject(['durable'])` 后装载；缺目录 = 合法空名册，坏文件 boot 失败响亮，168–171 行）。依赖方向 web-app→sdk→engine、引擎 SDK 盲（ADR 0012 原文兑现）。上游耦合仅 cwd 相对路径约定（与 ledger 同域）。

### 3.5 sync 重放成本总账（前端可归因）

- 登记簿数据行约 22 条，前端可归因约 11 条（§1 表）；其中高摩擦 1 条（fixture.ts）、卫生 2 条（未登记 spec 文件、过期路径）、其余 8 条加性低摩擦。
- **2026-08-28 sync 实证：登记簿机制工作正常**——一行因此消解（`packages/boot/app-boot/src/profile.ts` #64：上游重写 heal 面后 fork 副本删除，登记行划掉）；fixture.ts 经受住 merge（checkpoint 后仅 +91/−5）。
- 真实隐性成本不在 merge 冲突而在**镜像义务**：durable 契约一变三处同步改（engine Remote / SDK wire face / fixture），且 fixture 绿 ≠ 真网关绿（#75 实证）。这是 §2.1 装饰器迁移建议的主要动机。

## 4. 对后续裁决票的喂给

- **#81（core-touch 处置）**：§2 每条裁决建议已备；优先两件 = durable/* fixture 装饰器迁移 spike（图外执行票，第一问 = 装饰器能否驱动 startRun 会话孪生）+ 两条卫生修复（fixture-durable spec 登记/迁移、built-boot 登记路径修正 + 登记簿全量路径校验）。
- **#82（路线 B 存续）**：后端缝隙面证据全面利好——网关/投影/装载三面零上游编辑，上游编辑集中在测试运输一个文件；路线 B 的架构成本可陈述为「fixture.ts 一处高摩擦 + 聚合行机械重放」，且前者有明确收敛路径（装饰器迁移）。

## 5. 方法与边界

一手来源：登记文件原文、daypaw 包源码、ADR 0001/0007/0011/0012、spec 05 §5、git 历史（checkpoint diff、fixture 演进链）。未做：登记簿 22 行全量路径时效校验（抽查发现 built-boot 一处过期，已建议执行票全量做）；装饰器迁移的孪生驱动面（`sessionApi`/`emitRemote` 公开可得性）未实测——spike 票的事。LOC 口径：fixture.ts 内 fork 块约 600+ 行（表 1880–2067、定义 2207 起、臂 3794–3910、种子 ~920–1000）。
