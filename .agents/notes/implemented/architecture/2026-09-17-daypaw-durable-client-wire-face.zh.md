# Agent Note：durable 客户端 face（`@daypaw/durable-client`）

Status: implemented

[English](2026-09-17-daypaw-durable-client-wire-face.md) | 中文

## 问题

浏览器平面把引擎的 Remote 面按消费者各实现了一遍。`callEndpoint`——`/api` 通道、`{ args }` 信封、ok/error 解包——在 `@daypaw/ui-inbox` 与 `@daypaw/ui-tasks` 里逐字节相同，只差错误前缀。`durable/listDefinitions` 带着三套独立解析器与两种容错策略（目录页与弹窗 fail-loud，首跑黄卡容忍坏行）。五值 run 状态词表散在八处，其中两张 `RUN_STATUS_KEY` 表各在不同包里、各自注释自称唯一出处，却没有一条测试对拍。读端点的唯一覆盖是 `runs-api.client.spec.ts` 里的手写字面量，因此列改名（`updated_at`、`def_kind`）单测全绿、浏览器照样炸。

## 决策

`@daypaw/durable-client` 是浏览器平面对引擎 Remote 面的唯一家（[票 #116](https://github.com/0xnicholas/daypaw-pro/issues/116)）：壳今日消费的七个端点（`listRuns`、`runLineage`、`journalTimeline`、`rerun`、`listDefinitions`、`startRun`、`steerText`）收在 `createDurableClient(rpc)` 返回的单一 `DurableClient` interface 之后；wire 行类型手声明，每种行一个 fail-loud 解析器；run 状态词表与其 zh/en 文案放进本包自持的 `'durable'` locale 命名空间。结构化 `steer` 与 `cancel` 暂无浏览器消费者，待真消费者出现再加。

wire 类型在本包声明，绝不 alias `@daypaw/engine`。alias 不可能与自己不一致，因此在边界上什么都证明不了；独立声明才是解析器校验的对象，漂移由执行捕获。该执行就是 `@daypaw/web-app` 扩展后的活网关 spec：七个端点全部经 `createDurableClient` 打到真 Typert 网关与真引擎——组装金样赛道走的是 fixture 传输，不做描述符校验。浏览器平面保持零 `@daypaw/engine` 依赖边。

解析一律 fail-loud。需要容错的消费方在自己的调用侧降级：首跑黄卡把名册这一腿包进 `try`/`catch`、名字回落 `FALLBACK_AGENT_NAME`，于是坏名册藏不掉密钥就绪黄卡，而解析器保持严格。各包 fake 实现单一 `DurableClient` interface、内部用手写字面量；等三个包重复出同一 fake 再抽共享模块。

## 考虑过的替代方案

**alias 引擎类型。** `@daypaw/engine` 导出 `RunRow`、`JournalRow`、`DefinitionView`，在浏览器包里 alias 它们可以省掉声明。但它也省掉了唯一能失败的那道检查：浏览器读的是比引擎返回字段更少的 JSON 投影，而共享类型会静默跟随的改名，正是解析器存在的理由。

**把包放进 `ui-inbox` 或 `web-app`。** IA 投影（`TaskRow`、`TaskDetailView`）属 `ui-inbox`，wire 词汇放进那里等于寄居在不拥有它的面子之下；`web-app` 是 UI 插件挂载其上的壳脚手架，依赖方向会反过来。

**各消费者 spec 里手写行字面量。** 引擎序列化一动它们也不会红——正是本次要除掉的缺陷。wire 契约的证明必须在真引擎上跑。

**建 `/testing` 子路径导出共享 fake。** 三个包当前重复同一 fake 形状；现在抽出等于为需求更窄的消费者（第二个消费者只读一个端点）发布测试面。等重复变成第三次再议。

## 后果

- 四个 `ui-*` 包不再持有 `durable/*` 端点字符串与 wire 行类型，wire 知识只有一个家。`runs-api.ts`、`task-status.ts`、`new-task-api.ts`、`run-status.ts`、`definitions-api.ts` 消失，`status.*` 键离开两份词典。
- 统一文案改动任务面两条英文串：`Done` → `Completed`、`Something went wrong` → `Failed`（中文文案本就一致）。组装金样记录该变化。
- #60 时代的空 `import type {} from '@daypaw/ui-inbox/client'` 逐条复核：`@daypaw/ui-tasks` 的 3 处是残留、已删；`@daypaw/ui-agents` 与 `@daypaw/ui-settings` 的那几处承载 ui-inbox 的 `SlotMap` 合并（槽名靠它定型，删掉即 typecheck 红），故每包保留一处有注释的携带者，并在依赖处写明模块 augmentation 是程序级全局的。
- 写解析器契约时两处 wire 事实得到澄清：journal 行的 `occurrence` 从 0 起（此前文档写 1 起），默认 step key 为 `name#occurrence`。
- 新客户端包在 profile 启动解析其 roster 行之前必须先有构建产物 `lib/`，且该行必须声明在 bundle 的 `dependencies` 里——治愈后的 profile 按 bundle manifest 链接行名，不看 `devDependencies`。
