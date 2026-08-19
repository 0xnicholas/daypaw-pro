# dsh seam 清点 v2（merge 后地形重扫）

> Wayfinder 研究票 [#21 「地形重扫：merge 后 seam 清点 v2」](https://github.com/0xnicholas/daypaw-pro/issues/21) 的成果，隶属地图 [#20 「daypaw-pro 架构重审（批次 C 开工前把关）」](https://github.com/0xnicholas/daypaw-pro/issues/20)。
> 日期：2026-08-19。调查对象：**本仓库当前树**（main @ `db32236cb3`，即 upstream merge `a0a2a87370` 之后）。本地地形研究：一手来源为仓库自身代码与文档，引用一律为仓库内路径。
> 基线：旧清点 `research/dsh-seam-inventory.md`（分支 `research/dsh-seam-inventory`，commit `80a7f708e9`，2026-08-16）。

## 0. 前提修正（票面叙述 vs 事实）

票面说「merge a0a2a87370 带入了清点时不存在或已大变的一批 family」。**代码史不支持「新出现」的读法**：

- 旧清点做于只读参考检出 `/Users/nicholasl/Documents/build-whatever/deepseek-harness`（HEAD `47f943859b`，2026-08-13），**早于清点提交本身**（2026-08-16）——范围内家族当时大多已存在。
- fork 侧 merge 前（`e393e4b050`）是纯设计文档仓库，`packages/` 整体由 merge 带入。
- 因此准确表述是：**这些家族不是 merge 后新出现，而是旧清点未覆盖**（当时 judged 与四支柱无关或低相关）。本 v2 的价值在补覆盖面 + 复核三条旧结论，而非追踪 upstream 增量。

对后续票的含义：支柱设计的「地形剧变」风险下调；真正的地形增量是**旧清点遗漏的控制面/检索面丰富度**（见 §2、§4）。

## 1. 三条旧结论复核

### ① 「跨 turn 编排 durability 全留白」——**成立，但需加注**

执行层仍全留白，逐项核验：

- jobs：`LocalJobRegistry` 仍全内存（`packages/jobs/jobs-local/src/index.ts:102` `private store = new Map<JobId, TrackedTask>()`；README Known Limitations「Jobs are process-local」）。不变。
- workflow：执行仍无 durable run 状态——worker thread 每 run 一个（`packages/workflow/workflow-worker-thread/README.md`），取消即 terminate，无 journal、无重放。
- schedule：仍 session-local——durable 状态在原 Session log，timer owner 仅在 root Agent live 时等待，绝不隐含外部唤醒（`packages/schedule/README.md`）。不变。

**需加注**：`tool-workflow` 现在向父 Session 写四个 durable 事件（`tool-workflow/run-start`、member start/end、`run-end`，`packages/workflow/tool-workflow/src/index.ts:120-126`）并带 invariant 校验（`packages/workflow/tool-workflow/src/invariant.ts`）——**显示事实已 durable 可回放**（`packages/client/ui-workflow-run/README.md`「Replays durable workflow runs」），但执行不复活。旧文「实际没有任何 run journal」应收窄为「**没有执行级 run journal；显示级已有**」。旧文「对话史活着，但一切『正在做的事』都死了」仍真，可补一句「且做事的叙事已留痕」。

### ② 「观测 = OTel logs + 单进程 UI」——**成立，内涵变厚**

- OTel 仍 logs-only：`packages/session/session-telemetry-otel/README.md`——OTLP/HTTP Logs 管线（`@opentelemetry/sdk-logs`，experimental tree），无 trace/span。不变。
- UI 仍单 runtime：`packages/client/connection/README.md`——单一 readiness 握手 + 双 WebSocket 下行，一个 host 进程一个 UI；无跨进程/fleet 面。不变。
- **加注**：单进程观测的丰富度大增——`ui-trajectory`（turn 级事件台账 + 时间轴 + token/耗时检视，`packages/client/ui-trajectory/README.md`）、`session.search`（FTS5 跨 session 检索，`packages/host/apiproxy/README.md`）、`session/projection` 推送帧、jobs/goal/workflow-run 的 UI 投影。「单进程 UI」不再是裸对话流，已含台账/检索/投影三种 Manager 前体形态。

### ③ 「SDK wire = prompt + 事件流最小面」——**成立（verbatim），但 Web 面须区分**

- SDK wire 不变：`packages/sdk/protocol/README.md` Known Limitations——「No cancel or session-close methods」「Server→client requests are dead capability」；`packages/sdk/client/README.md`——「No mid-turn cancel」「No per-prompt result or cancel」。逐字仍真。
- **关键加注**：**Web wire 不是 SDK wire**。`packages/host/apiproxy/README.md` 的 `/api` 契约已有 `session.cancel`（仅中止当前 turn、保留 pending inbox）、`session.updateQueue`（编辑/移除排队消息）、`session.models`/`selectModel`、`agentPreset.select`（blank session 换 preset）、`session.fork`、`session.search`、`session.export`（ZIP 含后代+媒体）；四象限 union 含 `ServerRequest`→`ClientResponse`（ask-user 在用）。且正迁移到 Typert Remote 栈（`packages/api/README.md`：legacy apiproxy 为未迁移方法的 fallback；`packages/bundle/web-app/cordis.patch.yml:99,165` 已挂 `api-gateway`/`api-remotes`）。
- 对「[落地计划更新](https://github.com/0xnicholas/daypaw-pro/issues/26)」类决策的含义：ADR 0004「控制走 store 命令 + 边界观察、v1 不扩 wire」的「wire」须显式指 **SDK wire**；Web Remote 面是现成、活跃演进的扩展骨架，Manager host 复用它不是「扩 wire」而是「长在既有网关模式上」。

## 2. 新入图家族逐个定界（16 项）

旧清点已覆盖且不变者一笔带过：**jobs**（内存，见 §1①）、**schedule**（不变）、**spill**（磁盘持久不变；`spill-policy` 为事后执行策略包，旧文已提 `ctx.spillStore`）、**feedback**（`command-feedback` log-only 不变；`message-feedback` 现附 Host `messageFeedback.*` Remote 契约，`packages/feedback/README.md`）、**storage**（`storage-sqlite` 现为独立 STRICT 后端：document-per-row、无迁移（仅认当前 schema 版）、单进程、无 busy-wait，`packages/storage/storage-sqlite/README.md`——engine store 自管 SQLite 的 ADR 0002 决策不受影响，此家簇是参考实现而非落点）。

### 与支柱强相关

- **goal**（`packages/goal/`）：事件溯源的同 session 目标状态——`goal/change` 全量快照进 Session log（唯一 durable 权威），续跑权（activation/armed）是**进程本地**，`goal-round-driver` 在 idle 时预留 round 注入 `<goal_round>` prompt（`packages/goal/goal-round-driver/README.md`）。Seam：Service（`ctx.goals`）+ Consumer（tool/命令/driver）。**支柱①近亲**：「durable 意图在 log + 进程本地驱动权 + 恢复后按 log 重建」正是 run 认领/复活的单 session 微缩版；round 上限/预留/竞态处理是引擎 step 去重的语义先例。
- **session-query**（`packages/session-query/`）：可信读取 + 关系追溯 + FTS5 全文检索（`session-query-sqlite`：专用派生 SQLite 库、可丢弃、TEMP 覆盖 live 行、generation 游标；`session-log-export`：ZIP 导出原始 artifact 含后代与媒体；`tool-session-query`：cwd 等权授权的模型面）。**支柱③④**：跨 session 检索 = Manager 查询面与 EVO 评估集「真实提取」的直接工具；派生索引模式是关联层的先例。
- **extensions**（`packages/extensions/`）：agent 自改运行时——定义注册表 + `node:vm` 沙箱 host runner + 浏览器双半包（`packages/extensions/README.md`）。**支柱②④**：其定义注册表是 ADR 0003 agent 定义注册表的运行时近亲（形态不同：动态定义 vs 进程内代码定义）；对 EVO 是「即时运行时变异」的对照物——EVO 显式不走此路（代码正典 + 人审 + 版本化）。
- **host / client / apps/web**（`packages/host/`、`packages/client/`、`apps/web/`）：Web GUI 两半。host = apiproxy 网关 + webserver + frontend-static + picker + plugin-inventory；client = 连接层 + runtime（SessionRuntime/WorkspaceRuntime）+ 全套 `ui-*`；`apps/web/src/main.ts` 仅 10 行薄引导。**支柱③**：网关/投影/台账/UI 插槽即 Manager 的宿主骨架（详见 §1②③加注与 §4）。
- **apps/cli**（`apps/cli/`）：`dsh` 启动器——profile/bundle 组合的入口，`--dump-config` 可见整树，`apps/cli/composition.md` 为生成组合图。**支柱②**：daypaw profile 将以 bundle 行接入此机制；Manager host 可复用同一启动器模式。

### 相邻

- **workspace**（`packages/workspace/`）：durable workspace 记录 + session 记账/排序/归档，domain KV 存储 + **pending-mutation marker**（启动只完成标记的变更）+ **boot 时从 header 索引重建**（`packages/workspace/workspace/README.md`）。支柱①：boot 扫描重建的先例；支柱③：session 的持久分组面（fleet 视图的分组维）。
- **attachment**（`packages/attachment/`）：不可变图片内容寻址存储于 `DSH_HOME` 下，提交先于任何 model-visible 事件（`packages/attachment/attachment/README.md`）。支柱④：评估集工件（截图等）的现成存储；保留/GC 已知延后。
- **code-runtime**（`packages/code-runtime/`）：模型写代码 + host 绑定的执行 seam（worker-thread provider，`tools: { mode: code }` 的 `run_code`）。支柱②④相邻：workflow（模型写脚本）与 code-runtime 是「authored code 执行」的两个现成形态；EVO 候选若生成代码变体有现成执行面。
- **sandbox**（`packages/sandbox/`）：per-session 进程约束策略——durable 模式覆盖走 `sandbox/mode` session 事件，`sandbox-policy` 统一 resolve（`packages/sandbox/sandbox-policy/README.md`）。支柱①：引擎执行带副作用 step 时按 run 解析同一策略的接入点；extensions/code-runtime 的 `node:vm`「非安全边界」声明反衬真沙箱归此家簇。

## 3. 逐支柱三列表

### 支柱① Durable Execution

| 列 | 内容 |
|---|---|
| 可挂载点（v2 新认） | `session-projection-cache` 的 fail-soft 折叠捷径 + log-lifecycle 绑定（ledger 重放加速先例，`packages/session/session-projection-cache/README.md`）；workspace 的 pending-mutation marker + boot header 重建（boot 扫描先例）；goal 的「log 权威 + 进程本地驱动权」模式（claim/复活语义近亲）；tool-workflow invariant 的「log 尾缺失终态 = 中断证据非损坏」判别（journal 尾部处置先例） |
| 被地形改变的前提 | 「无任何 run journal」→ 显示级 journal 已在（`tool-workflow/*` 四事件）；「workflow 只礼貌报死」→ 对执行仍真；旧文引用指向参考检出 → 应指向 fork 树 |
| 新出现的替代物 | **无**——upstream 仍无 durable workflow engine / 持久 timer / 后台任务持久化；自建决策（ADR 0002）土壤未变 |

### 支柱② Agent Engine + SDK

| 列 | 内容 |
|---|---|
| 可挂载点（v2 新认） | extensions 的定义注册表 + `node:vm` 运行形态（注册表实现的参照）；`interaction` 家族的 user-questions seam + Web 四象限 `ServerRequest`（HITL gate 的现成 UI 运输，`packages/interaction/README.md`）；subagent 家族已扩（`subagent-acp`/`claude-code`/`codex`/`fork-in-process`/`spawn-in-process`/`tool-subagent-control`/`report`，`packages/subagent/`） |
| 被地形改变的前提 | 「wire 无 cancel」→ SDK wire 仍无、Web 面已有（§1③）；ADR 0003「API 运输无关留口」现在有 api/ Typert Remote 栈作落地参照（`packages/api/README.md`） |
| 新出现的替代物 | **无**——defineAgent/defineWorkflow 无对应物；upstream `workflow` 是模型写脚本的编排，不是用户代码优先编程模型 |

### 支柱③ Agent Manager

| 列 | 内容 |
|---|---|
| 可挂载点（v2 新认） | `session-query-sqlite` 派生索引（关联层先例：专用库、disposable、FTS5、generation 游标）；`session.export` ZIP（run 证据导出）；`ui-trajectory` 事件台账（单 session Timeline 雏形）；apiproxy/api Remote 网关 + `session/projection` 推送（manager host 骨架）；workspace registry（fleet 分组维）；`plugin-inventory`（只读插件面） |
| 被地形改变的前提 | 「apps/web 单 runtime UI」内涵变厚（台账/检索/投影三前体已在）；「UI 参照 Temporal Web UI」的增量收敛为**跨 run/跨进程聚合 + durable run 视图 + 控制命令**三件事 |
| 新出现的替代物 | **无完整 Manager**；但单进程观测/检索/控制面显著加密，支柱③自建面比旧清点时**更窄**（收窄为 fleet + durable-run 面） |

### 支柱④ EVO

| 列 | 内容 |
|---|---|
| 可挂载点（v2 新认） | attachment 内容寻址存储（评估集工件）；session-query FTS + cwd 过滤（评估集「真实提取」的检索面）；`tool-session-query` 的 workspace 等权授权模式 |
| 被地形改变的前提 | 「反馈只有记录没有回流」仍真；message-feedback 现有 Remote 契约（UI 消费延后） |
| 新出现的替代物 | extensions 的「模型自改运行时」= EVO 的**即时变体**对照物——EVO 章应显式区分「版本化离线优化（代码正典+人审）」与「即时运行时变异（无版本、可撤回）」；两者不冲突但词汇须互斥 |

## 4. 旧清点文档作废/加注清单

旧文在 throwaway 分支 `research/dsh-seam-inventory`（未合入 main），下列为其需要修订的具体断言：

| 位置 | 原断言 | 处置 |
|---|---|---|
| 头部 | 「调查对象：本地 deepseek-harness 仓库（只读）」 | 改指 fork 树（main @ merge 后） |
| §② workflow 行 | 「实际没有任何 run journal」 | 收窄：执行级无、显示级已有（`tool-workflow/*`） |
| §② workflow 行 | 「进程死了…workflow 不会续跑，只会被礼貌报死」 | 保留，加注「叙事已 durable」 |
| §③ storage 行 | 「`ctx.storage` 命名后端（json/sqlite）」 | 补 storage-sqlite STRICT/no-migration/单进程事实 |
| §⑤ 尾注 + 支柱③清单 | 「apps/web + ConversationNodeDefinition 渲染扩展点」 | 加注 Web 网关控制面（cancel/queue/preset/search/export）与 api/ Remote 迁移 |
| §⑥ 加包 checklist | cookbook 流程 | fork 侧已由 `docs/fork/adding-a-daypaw-package.md` 接管（upstream cookbook 对 dsh-scope 仍权威） |
| 跨切事实 3 | 「wire 协议是 prompt+事件流最小面…SDK 编程模型选进程内嵌还是扩 wire」 | 加注：该「wire」= SDK wire；Web Remote 面是第三选项的骨架 |

其余断言（jobs 内存、schedule session-local、checkpoint 屏障、遥测面、事件签名表）逐项复核**仍成立**。

## 5. 结论（喂给哪些票）

1. **[需求重审：四支柱性价比](https://github.com/0xnicholas/daypaw-pro/issues/22)**（首要输入）：地形无新替代物、无剧变——四支柱的自建土壤未被动摇；但支柱③的自建面因 upstream 单进程观测/检索/控制面加密而**收窄**，性价比核算应按收窄后的面重算。
2. **[一致性走查](https://github.com/0xnicholas/daypaw-pro/issues/23)**：ADR 0004「v1 不扩 wire」需消歧（SDK wire vs Web Remote 面）；spec 03 的「扩展 dsh web app（直读 SQLite）」前提仍成立且更具体（网关/投影/台账骨架现成）。
3. **地图 #20 雾区**「Manager 形态参照研究」可部分毕业：upstream web app 形态**未大变**（仍是单 runtime 网关+SPA），无需新参照研究；残余问题并入需求重审/一致性走查。
4. 支柱①的 ADR 0002/0008 不受地形影响，批次 C 设计输入无变化。

## 来源

- 全部为仓库内一手来源，正文以路径随文标注；关键文件：`packages/{jobs,workflow,schedule,goal,workspace,session-query,attachment,code-runtime,sandbox,extensions,storage,feedback,host,client,subagent,interaction,api}/…`、`apps/{cli,web}/`、`packages/bundle/{base,web-app}/cordis.patch.yml`、`docs/subsystems/workflow.md`。
- 代码史核验：`git show research/dsh-seam-inventory:research/dsh-seam-inventory.md`；参考检出 HEAD `47f943859b`（2026-08-13）；fork merge 前态 `e393e4b050`（无 packages/）。
