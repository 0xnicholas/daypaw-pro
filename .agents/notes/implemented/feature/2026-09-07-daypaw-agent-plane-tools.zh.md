# Agent Note: daypaw 的 agent 面回到宿主组合——审批护栏下的全套工具行

Status: implemented

[English](2026-09-07-daypaw-agent-plane-tools.md) | 中文

## 问题

daypaw profile 整组照抄了上游 web overlay，包括「agent 面退到 agent preset 之后」一节：底册的模型侧工具行（`tool-bash`/`tool-pwsh`/`tool-jobs`/`tool-fs`/`tool-fs-search`/`tool-str-replace-editor`/`skill-filesystem`/`tool-skill`/`tool-goal`/`plan-mode`/`compaction-basic`/`command-compact`/`tool-result-pruner`/`tool-subagent-*`/`workflow-worker-thread`/`tool-workflow`/`tool-ralph`/`agent-instructions`/`tool-todo`/`tool-web`）全部 `disabled: true`，由 preset 名册顶替。这在 daypaw 恰好饿死了最要紧的 agent：壳发起的任务是**引擎 run**（ADR 0012），其 SDK agent 从不加入 preset，而种子 agent 声明 `tools: []`——产品主表面因此只跑裸模型 + `submit`（[#97](https://github.com/0xnicholas/daypaw-pro/issues/97) §0.2）。五个已挂 UI 面（ui-jobs、ui-goal、ui-plan、ui-subagent、ui-workflow-run）、斜杠命令面板的工具域命令、审批面全部无生产者——走查缺口③（[#84](https://github.com/0xnicholas/daypaw-pro/issues/84)）：敏感操作根本不存在，收件箱「等待你确认」分组长期空转。

## 决策

ADR 0013 §3 裁定能力底座全开、审批护栏不动，[工单 #103](https://github.com/0xnicholas/daypaw-pro/issues/103) 落地：daypaw 的 `cordis.patch.yml` 删除整组禁用行，底册行原样穿透 overlay，全套模型侧工具行骑在**宿主面**上——进程内每个 agent（普通壳会话与引擎 run 的 SDK agent 一样）继承全局工具层，因为 `defineAgent` 的 `tools` 数组只做加法、从不做减法。三个随行裁决保持一行一属面：

- **`agent-presets` 插入行禁用**（不删除——上游行对 sync 保持可见）。此后新建会话组合宿主组合，即名册服务缺席时上游文档化的回退路径；在底册行已活的基础上再挂 `standard` 会让每行同时上双面（`isolate` realm 为自己的消费者遮蔽宿主实例；宿主单例注册在第二个会话上碰撞）——正是 `verify-cordis-config` 的 preset 面分离门为上游自身文件编码的两类失败模式。
- **`tool-ask-user` 宿主面插入**——standard preset 唯一没有底册行的能力（上游仅随 preset 交付）；不补它，preset 退场会静默丢掉 `ask_user_question`，即已挂 ui-user-questions 面的生产者。
- **`subagent-model-selection-settings` 插入行撤除**（连同 `@deepseek-ai/dsh-tool-subagent` 依赖）：它唯一的采用者是 preset 的 `tool-subagent` 行（`modelSelectionSettings: true`）；底册行不采样它，fork 也没有任何表面编辑该 namespace，留着是明知无效的组合。

#46 保守默认——workspace-write 沙箱、审批 `ask`，两者本就宿主面挂在底册——原样不动，成为开放面之上的唯一防线，与裁决一致。

## 后果

引擎 run agent 的审批闭环全程活了：沙箱升级（`sandbox_permissions` + justification，敏感操作的形态）触发 scoped `approval/request` waterfall——`api-remotes` 桥到网关、浏览器审批板应答的那条缝——并写入回合封闭的 `approval/asked` + `approval/decided` 审计对，供收件箱分组、对话内即时卡与 fork 的审批历史投影读取。`tests/agent-plane.spec.ts` 免 key 地钉住全部环节：boot 真实 bundle 组合（隔离 profile home、web 传输行关闭），断言裸 agent 目录（27 个工具）、工作区内写入不询问、批准路径的 asked/decided 对、悬置等待态、以及拒绝路径的封闭失败与零执行。`tests/roster-coexistence.spec.ts` 钉住组合行态。五个饿着的面与工具域斜杠命令从此在每个 agent（含引擎 run）上都有生产者。针对真实壳与真实模型的一次实走（2026-09-07，工单 #103）在 wire 上走完同一环：模型首次工作区外写入被沙箱拒绝，按规程带升级请求重试，网关的 Remote Event mux 向一个新流代际投递了挂起的 `approval/request` 帧（浏览器重连消费的冷启动重放），经 `$events/result`——「同意」按钮的同一调用——应答后裁定 `allowed-once`，升级写入落地。

此变更前以 `standard` preset 组合的存量会话在宿主组合上恢复（preset 服务缺席，session-controller 走裸 setup 回退）；其日志里的 preset 身份陈旧但无害，工具面等价、只差 preset 的 `subagent` 模型路由配置（fork 表面本就无处可设）。与上游 overlay 的差异进一步扩大——fork 在 ADR 0012/0013 裁决之处有意分叉，yml 注释承载一面一行理据，其归宿在 `.agents/notes/implemented/architecture/2026-08-10-host-plane-ownership-after-presets.md`。

## 备选与否决

**启用底册行并保留 `agent-presets default: standard`**：否决——standard 的每行都会双挂（preset scope 遮蔽全局层，外加每个常驻挂载多一条 workflowEngine 工作线程、plan realm 与压缩栈）；一行只属于一个面。

**经种子 agent 的声明给它工具**：否决——dsh 插件工具不是 agents 文件可导入的 `ToolDefinition`（注入式工厂只传 SDK 命名空间），且逐 agent 声明会把能力底座变成每个 agent 作者的函数而非组合事实；ADR 的措辞是底座，不是种子。

**在 SDK agent setup 里自动加入 standard preset**：否决——违背 `defineAgent` 的静态组合契约（`tools: []` 将不再意味着裸表面 + `submit`），并把引擎的 agent 面绑到产品已退役的 preset 名册上。

**把 preset 默认切到 `minimal`**：否决——`minimal` 自带完整 persona 与隔离的本地 fs realm，对轻对话的改变远大于宿主面回退，且仍让一族行挂在两个面上。
