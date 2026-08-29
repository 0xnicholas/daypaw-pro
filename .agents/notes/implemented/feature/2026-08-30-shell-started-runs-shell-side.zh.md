# Agent Note: 壳发起 run，壳侧——弹窗、看板与 preset 退场

Status: implemented

[English](2026-08-30-shell-started-runs-shell-side.md) | 中文

## Problem

[宿主侧](2026-08-30-shell-started-runs-host-side.zh.md)给了壳宿主定义注册表与 `durable/startRun`，但浏览器仍按旧方式发起任务：新任务弹窗选 dsh preset、走 `agentPresets.list → sessions.create → prompt`，看板的对话打开仍锚在那条 create 路径上，首跑黄卡仍以默认 preset 命名。票 #67 把壳 UI 焊到引擎上：弹窗读 `durable/listDefinitions` 并起 run，起跑的 run 入列并打开其对话（sessionId ≡ runId），preset 面退为兼容层。

## Decision

- **弹窗名册即引擎注册表**（一名册，ADR 0012）。`NewTaskStore` 改经 connection 通用 RPC 通道装载 agent 定义（`new-task-api.ts`：`durable/listDefinitions` 过滤 `kind: 'agent'`，wire 边界校验载荷——ui-agents 目录先例）。行以 `name@version` 作 select 值（提交钉死精确版本，多版本共存永不静默挑选），标签取 display 业务名、未声明回落技术名，首行预选——注册顺序就是 `loadAgentFiles` 保证的顺序。
- **输入面跟 `inputKind` 走**（裁决 #65 §7）：`text` 渲自由文本框，`json` 与 `null`（无 wire 面的引擎原生定义）渲染 JSON 框加内联语法校验——坏草稿禁用提交并显示本地化 JSON 错误；定义自身的 zod 契约仍在 host 侧终校。`z.object({ task: z.string() })` starter 形状由弹窗递交裸字符串，**收拢归 wire face**：`wireFace` 把 `parseInput` 编译为收自由文本、包成 `{ task }` 再过 zod parse——两种 starter 形状递交同一份 wire 载荷，`inputKind` 保持纯呈现语义。ledger 行的 `input_json` 证明收拢（sdk `agents-dir.spec.ts` 钉住）。
- **提交铸造一个 run id，失败保留。** `pendingRunId` 在首次提交尝试时惰性铸造，跨失败提交存活（内联失败、草稿保留）；`durable/startRun` 的 start-or-attach 让重试落回同一 run 而非重复建。成功后清空，下一个任务重新铸造。start 应答后，store 等 run 的 **session 孪生**进 sessions 列表投影（`whenListed`，`TWIN_WAIT_MS` 有界、计时器可注入——建会话前就失败的 run 以内联失败退役提交而非永久停机，保留的 id 让重试接回）：引擎在首次驱动时建会话并广播 `api-session/added`，而 `sessions.open` 对未列出 id 会 loud 失败——所以 `openTask` 只在对话真能解析时触发。名册加载失败在下次打开对话框时重试（effect 从 `error` 而非仅 `idle` 重载）。InboxNav 的 `openTask` 同时踢一记看板刷新（新增 `refreshBoard` inject），run 不等 2s 轮询即入列。
- **preset 退场 = patch 禁用 + 命名源切换。** daypaw patch 禁用 `ui-agent-preset`（禁用而非删除——共享基座先例）：其「事前」面（General 默认 preset 行、新会话 chip、名册管理节）会承诺产品不再提供的选择，而已组合 preset 的会话保持装载时的组合、照常可开。首跑黄卡命名源从默认 preset 切到名册首 agent（经 connection RPC 通道读 `durable/listDefinitions`——播种 starter 的 display 名，空名册回落通用名）。
- **fixture 镜像引擎的 start 语义**，client 车道保持免 key：`durable/startRun` 解析注册表身份（精确版本或名字的唯一条目——歧义拒绝并列名候选）、收拢 starter 文本形状、已有 run id 直接作 attach 应答，否则追加 running 行、建 sessionId≡runId 孪生、经内部 prompt 路径驱动首轮——首条 user message 是输入的 JSON 序列化（对话实际显示的 ADR 0010 行为）。

## Alternatives considered

- **task 形状由弹窗发 `{ task: text }`**——需要把形状暴露进 `DefinitionView`（引擎面增长），且形状知识分裂到 wire face 与弹窗两处。收拢属于编译期 face，它本来就持有契约。
- **`null` inputKind 行在弹窗名册里标「高级」**——daypaw 组合里引擎原生注册不会出现（SDK bind 恒盖 wire 面）；JSON 框已诚实覆盖该形状，无需新文案。
- **黄卡保持 preset 命名**——preset 已是兼容层；用用户挑不到的名册命名首跑卡是假的。
- **从 patch 行里删除 `ui-agent-preset`**——删除会让该行在基座重排时静默回归；带裁决注释的禁用标记才是可审计的退场。

## Consequences

- 壳发起的任务端到端是 durable run：弹窗 → `durable/startRun` → 孪生等待 → 对话；看板列出该 run（踢 + 轮询），其行打开同一会话；SIGKILL 复活骑引擎 boot 扫描，壳侧零状态。
- 对话首条 user 行显示输入的 JSON 文本（`{"task":"write a poem"}`）——ADR 0010 的落账首消息契约，fixture 回声同形。starter 形状的首消息可读化属引擎/SDK 决策而非壳投影；此处记为缓做项。
- #60 双名册 Known Limitation 解除（ui-agents README 更新）；preset 会话仍可见可开（看板投影的 sessions-list 侧未动）。
- 旧的 preset-less 套件换形：ui-tasks 的 fake 与 specs 改编 `durable/*` 端点；ui-settings 的卡 specs 编排名册 RPC；组装 golden（弹窗选项、对话形状、目录网格）记录定义名册世界。

## Testing

ui-tasks：wire 模块 spec（名册校验含全部拒绝分支、startRun 结果校验）、store spec（名册投影、latest-wins、守卫、孪生等待的 park/无关更新/释放及其时限触发、铸造 id 跨失败→成功→新任务的恒等、json 草稿解析/守卫）、dialog spec（两种输入面、内联 JSON 错误、空名册、加载失败与下次打开重试、快照）与 apply spec（RPC 通道上的 inject face）。ui-settings：card-store over 名册 RPC（业务名/技术名/通用名回落、坏行、迟到失败的静默）。ui-inbox：openTask 看板踢。sdk：裸文本 `{ task }` 收拢经 `startRun` 断言 `input_json`。fixture spec 钉 start-or-attach、收拢、孪生入列、id 铸造与两条拒绝消息。组装车道刷新 `inbox-conversation`（弹窗 → run → 对话 → 看板行 → 回对话）与 `agents-catalog` golden；所有触及的非豁免源文件逐文件覆盖 100%。全量红是 sync note 里已记录的 node-26 环境基线，与本 diff 无关。
