# ADR 0012: 壳发起 run——定义装载与一名册

- **状态**：已接受（2026-08-30，[壳发起任务直通引擎 run：双名册与会话↔run 统一裁决](https://github.com/0xnicholas/daypaw-pro/issues/65)）
- **前置**：ADR 0003（编程模型与五原语）、ADR 0006（包结构 sdk→engine→store）、ADR 0010（defineAgent 编译与执行）、ADR 0011（CLI 自含交付与 profile 播种）

问题：壳发起的「任务」是 dsh preset 会话（新任务弹窗走 `agentPresets.list → createSession → prompt`），引擎 durable run 只能由 SDK 代码启动——壳对引擎面只读 + steer + rerun。产品的两半（壳体验与引擎耐久性）没有焊在一起；preset 名册与引擎定义注册表双名册（#60）、对话供数临时投影（#56）都是该割裂的症状。

## 决策

### 1. 壳宿主的定义注册源：cwd `daypaw/agents/` 目录扫描装载

- 壳宿主（`daypaw` 命令拉起的 Node 进程）boot 时扫描运行目录下的 `daypaw/agents/`——与账本同域（种子 patch 的 `daypaw/ledger.db` 同为 cwd 相对路径），每个工作区自带 agent 集与自己的 ledger。
- **注入式工厂**是唯一文件形态：`export default ({ defineAgent, defineWorkflow, z }) => definition`（或定义数组），装载器把 SDK 命名空间作实参传入；文件零裸导入，同目录相对导入可用。动机：交付态下 daypaw 家族链接在 `$DSH_HOME/profiles/node_modules`，工作区解析不到裸说明符；cwd 自装则引入同进程双 SDK/engine 拷贝（类身份断裂）。`.mjs`/`.js`/`.ts` 为模块扩展名，其余条目忽略；缺目录 = 合法空名册；坏文件（导入失败、无 default 工厂、工厂抛错、产物非定义）失败响亮指名文件——装载回调是 Cordis 插件 fiber，Loader 树中拒绝即 boot 失败。文件按名序装载，注册顺序（即 `durable/listDefinitions` 顺序）跨平台稳定。
- **装载器住在 `@daypaw/sdk/agents-dir`**（`loadAgentFiles(ctx, dir)` 纯函数），**组合住在 `@daypaw/web-app` 胶水**（`agentsDir` 配置，默认 `daypaw/agents`；`ctx.inject(['durable'])` 后装载）。依赖方向不变（web-app→sdk→engine）；引擎保持 SDK 盲。不装 engine 行的组合不服务名册——用户删 engine 行即删产品组合，是有意行为。

### 2. `durable/startRun` 端点：start-or-attach

- 入参 `{ defName, defVersion?, input, runId? }`，返回 `{ runId }`。start-or-attach 语义与 SDK `def.run()` 对齐：弹窗生成 runId，重试安全。
- **版本解析**：显式版本钉死身份；缺省解析该名字在注册表中的唯一版本，多版本（或跨 kind）共存要求显式版本，拒绝时列名候选。kinds 共享名字空间：同名 agent 与 workflow 是歧义，不是优先级。
- **结果不随端点返回**：浏览器经 `listRuns`/`journalTimeline` 轮询观察 run（spec 05 §5 轮询模型）；失败 run 不以宿主未处理拒绝浮出。

### 3. wire face：输入呈现与校验的编译期挂载

- `EngineDefinition` 增可选 `wire: { inputKind, parseInput }`：`bind`/`bindAgent` 编译时从 zod input 契约结构检测 `inputKind`——`z.string()` 与 `z.object({ task: z.string() })` 为 **text**（弹窗自由文本直收），其余为 **json**（降级 JSON 文本框）；`parseInput` 是 zod parse 的不透明 thunk，`durable/startRun` 边界在插入 run 前调用。引擎不检视其内部（ADR 0010 的引擎盲编译延伸到 wire 钩子）；无 wire 面的引擎原生注册定义，输入原样入账。`durable/listDefinitions` 视图投影 `inputKind`（null = 无 wire 面）。

### 4. 一名册：引擎定义即名册，preset 退上游兼容层

- 弹窗与目录页只读 `durable/listDefinitions`；preset 机制退为上游兼容层（仅影响旧会话）。#60 双名册 Known Limitation 解除。
- **starter agent 随 CLI 首跑幂等播种**到工作区 `daypaw/agents/starter-assistant.mjs`（仅缺失时写入，永不覆盖——#34 profile 播种先例）：steerable 通用助手，starter 输入形状（`z.object({ task: z.string() })`），模型路由 `deepseek-official/deepseek-v4-flash`。零 agent 文件的工作区弹窗也有可选。

### 5. 供数切换（壳侧落地属票 #67，此处记终局）

任务列表主源切 `durable/listRuns`，无 run 会话并列展示（同 #57 看板 ∪ 裁决）；run 行打开 sessionId≡runId 的会话；#56 的 `sessions.list` 临时投影退役；弹窗只发 run。

否决：preset yml 扩展为引擎 agent 声明（zod 契约是 TS 值，yml 装不下，需造 DSL 子集）；cwd 自装依赖裸导入（双拷贝风险）；装载器重写裸说明符（机制脆：source map 断、缓存键费）；`$DSH_HOME` 全局 agent 库或两层合并（个人工具与工作区数据混域；无真实需求支撑两层裁决）；preset 自动桥接为定义（桥接面复杂且违背注入式工厂）。

## 后果

- 「任务」单一概念成立：壳发起即 durable run，SIGKILL 续跑、审批挂起、rerun、steer 全链生效；壳侧 UI 切换（弹窗、列表主源、对话投影、preset UI 退场）由 #67 落地。
- spec 00（profile 配方与交付面）、spec 02（SDK 面：装载器与 wire face）、spec 05（§4 壳宿主职责、§5 供数终局）回填本裁决；CONTEXT.md 增补词汇（壳宿主、agents 目录、注入式工厂、starter 播种、preset 兼容层）。
- engine/sdk/web-app/cli 四包 README 契约同步（新端点、新导出、新配置、播种行为）。
- EVO 前提补强：定义即文件意味着「候选变体」= 工作区里的新版本文件，评估回路的数据面（ledger 定义版本记录）与作者面（agents 目录）都已就位。
- 已知限制：agents 文件是宿主进程内执行的代码（等同 shell 信任，与 preset 一致）；`.ts` 文件仅在 source launch（tsx）下可装载，交付态写 `.mjs`。
