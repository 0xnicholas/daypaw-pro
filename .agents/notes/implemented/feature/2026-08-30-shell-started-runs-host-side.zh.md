# Agent Note: 壳发起 run,宿主侧——agents 目录、startRun、starter 播种

Status: implemented

[English](2026-08-30-shell-started-runs-host-side.md) | 中文

## Problem

票 #65 裁决壳发起的任务必须成为 durable run,但两半没有焊上:壳宿主(`daypaw` 拉起的 Node 进程)组合了 `@daypaw/engine`,定义注册表却**恒空**——`defineAgent` 值只存在于 SDK 作者自己的进程里——弹窗只能选 dsh preset,目录页结构性为空,而且 wire 面没有任何启动路径(六个 `durable/*` 端点全是读/steer/rerun)。票 #66 落地宿主侧:壳宿主的定义源、启动端点、以及让空工作区也有名册的首跑 starter。

## Decision

- **注册源 = `daypaw/agents/` 目录扫描,注入式工厂**(ADR 0012)。`loadAgentFiles(ctx, dir)`(`@daypaw/sdk/agents-dir`,新增子路径导出)按名序 import 每个 `.mjs`/`.js`/`.ts` 文件,以其 default 导出调用 SDK 命名空间——`export default ({ defineAgent, defineWorkflow, z }) => 定义`(或定义数组)——产物经 `bindAgent`/`bind` 注册。文件零裸导入:交付安装把 daypaw 族链接在 `$DSH_HOME/profiles/node_modules`,工作区的父级解析够不到,自装则会在进程内装入第二份 SDK/engine 拷贝。缺目录 = 合法空名册;坏文件(导入失败、无 default 工厂、抛错、产物非定义)失败响亮指名文件。组合住在 `@daypaw/web-app` 胶水:新增 `agentsDir` 配置(默认 `daypaw/agents`,与 ledger 路径同为 cwd 相对),在 `ctx.inject(['durable'], …)` 内装载——async 插件 fiber,其拒绝使 Loader boot 失败,即失败响亮通道;不装 engine 行的组合有意不服务名册。
- **`durable/startRun`**(`@Remote`,循 `listDefinitions` 先例):`{ defName, defVersion?, input, runId? }` → `{ runId }`,start-or-attach 与 SDK `def.run()` 对齐。版本解析:显式版本钉死身份;缺省解析该名字的唯一注册定义,多版本共存即拒绝——kinds 共享名字空间,同名 agent 与 workflow 是歧义而非优先级;拒绝时列名候选。handle 的 result 刻意不等待、不返回:浏览器经 `listRuns`/`journalTimeline` 观察 run(spec 05 §5 轮询模型),`handle.result.catch(() => {})` 使失败 run 不以宿主未处理拒绝浮出。
- **wire face 编译期挂载。** `bind`/`bindAgent` 把 `wire: { inputKind, parseInput }` 落进引擎定义记录:`inputKind` 从 zod input 契约结构检测(`z.string()` 与 `z.object({ task: z.string() })` 为 `text`——弹窗自由文本形状;其余 `json`),`parseInput` 是 zod parse 的不透明 thunk。引擎在 `startRun` 边界、插入 run 之前调用,从不检视其内部——ADR 0010 的引擎盲编译延伸到 wire 钩子。`durable/listDefinitions` 投影 `inputKind`(无 wire 面为 `null`;与 `display` 缺席同理,JSON 安全)。
- **starter 播种。** `@daypaw/cli` 的 `seedStarterAgent(dir)` 仅在缺失时写 `daypaw/agents/starter-assistant.mjs`(#34 profile 播种先例):steerable 通用助手,starter 输入形状,路由 `deepseek-official/deepseek-v4-flash`。`bin.mjs` 每次启动播种,新工作区的弹窗恰有一个可选项。

## Alternatives considered

- **preset yml 作声明面**——zod 契约是 TS 值;yml 装不下,除非造 DSL 子集。#65 已否决。
- **工作区自装依赖 + 裸导入**——书写自然,但安装摩擦 + 进程内双拷贝风险。#65 已否决。
- **装载器重写裸说明符为宿主拷贝**——保留语法但 source map 断、缓存键复杂、失败被藏住。#65 已否决。
- **`$DSH_HOME` 全局 agent 库 / 两层合并**——个人工具与 per-workspace ledger 数据混域;两层裁决尚无真实需求。#65 已否决。
- **独立 `@daypaw/agents` 插件包**——为一行组合新建整包;web-app 胶水已是产品组合 owner,依赖方向(web-app→sdk→engine)保持干净。

## Consequences

- 壳宿主注册表不再结构性为空;弹窗/目录读单一名册(`durable/listDefinitions`),preset 退上游兼容层(#60 双名册 Known Limitation 随 #67 的弹窗切换解除)。
- agents 文件是宿主进程内代码——与 shell 访问同信任,与 preset 一致。`.ts` 仅 source launch(tsx)下可装载;交付态工作区写 `.mjs`。
- EVO 前提补强:候选变体 = 工作区里的新版本文件;数据面(ledger 定义版本)与作者面(agents 目录)都已就位。
- 壳侧 UI(弹窗读定义、看板切 run 主源、sessionId≡runId 对话投影、#56 投影退役)归 #67;daypaw web 快照车道的 golden 刷新也归 #67。宿主侧覆盖:engine `start-run.spec.ts`(11)、sdk `agents-dir.spec.ts`(10)、web-app roster 接线(3)、cli 播种(2)。
