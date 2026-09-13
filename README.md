# daypaw-pro

[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 fork：在其「一切皆插件」、由 [Cordis](https://github.com/cordiverse/cordis) 驱动的基座上构建 [daypaw](packages/daypaw/README.zh.md) —— TypeScript Agent Stack 的 durable 执行引擎、agent SDK 与浏览器产品壳。自用为先，同时以 npm 自含单包支持外部客户自跑（[ADR 0011](docs/adr/0011-customer-self-run-delivery.md)）。

上游由 [DeepSeek AI](https://deepseek.com) 开发，其插件架构设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)，文档站为 [deepseek-harness.github.io](https://deepseek-harness.github.io/deepseek-harness/)。本 fork 的设计语料中文优先：领域词汇见 [CONTEXT.md](CONTEXT.md)，架构决策见 [docs/adr/](docs/adr/)，规格见 [docs/spec/README.md](docs/spec/README.md)；对上游文件的改动逐条登记于 [docs/fork/CORE_TOUCHES.md](docs/fork/CORE_TOUCHES.md)。

## daypaw 是什么

定位是「持久执行 + agent 的日常驾驶舱」（[ADR 0013](docs/adr/0013-positioning-review-dual-mode.md)），现役两根支柱（[ADR 0009](docs/adr/0009-pillar-review-manager-evo-deferred.md)）：

- **Durable Execution** —— `defineWorkflow` / `defineAgent` 声明的 run 跨 turn、跨进程持久化：幂等 `ctx.step` 去重副作用、持久 timer、HITL gate 挂起（等待零算力、进程可退出）、boot 扫描复活未完 run；进程被 SIGKILL 杀死后同一调用自动接回原 run 续跑至类型化完成（[spec 01](docs/spec/01-durable-execution.md)）。
- **Agent Engine + SDK** —— 声明式 `defineAgent`（zod 输入/输出契约、prompt 段、工具面、模型路由）与代码优先的 `defineWorkflow` 共用一个 run 概念；[`@daypaw/sdk`](packages/daypaw/sdk/README.zh.md) 是类型化 facade，`bind` 后的 `run()` 是幂等 start-or-attach，调用方持有类型化 `RunHandle`（[ADR 0003](docs/adr/0003-engine-sdk-programming-model.md)、[ADR 0010](docs/adr/0010-define-agent-compilation-and-execution.md)）。

在此之上交付一个业务语言的浏览器产品壳：`daypaw` 命令拉起壳宿主，任务、审批收件箱、agent 目录与轻对话都是引擎概念的业务呈现（词汇映射见 [CONTEXT.md](CONTEXT.md)）。Agent Manager 与 EVO 为远期独立子项目（[ADR 0009](docs/adr/0009-pillar-review-manager-evo-deferred.md)）。

daypaw 处于 0.x：不承诺跨版本兼容，升级须先 drain ledger 或弃库重跑（[ADR 0011](docs/adr/0011-customer-self-run-delivery.md)）。运行前请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 快速开始

### 安装 `@daypaw/cli`（自跑交付）

`@daypaw/cli` 是自含单包：全部运行时依赖（含上游 `@deepseek-ai/*` 包）打进 tarball，无需另装 dsh。

```sh
npm i -g @daypaw/cli
daypaw
```

裸 `daypaw` 启动浏览器壳并打印携带启动令牌的 URL 行（`daypaw web: http://127.0.0.1:<端口>/?token=…`），在浏览器打开该 URL 即可；durable ledger 落在启动目录的 `daypaw/ledger.db`。详见 [`@daypaw/cli`](packages/daypaw/cli/README.zh.md)。

### 嵌入自己的应用（`@daypaw/sdk`）

```sh
npm i @daypaw/sdk @deepseek-ai/cordis@~4.0.1 @deepseek-ai/dsh-attachment@~0.1.3-alpha.2 zod@^4.4.3
npm i -D @types/node
```

```ts ignore-check
import { bind, defineWorkflow, DurableEngine } from '@daypaw/sdk'
import { z } from 'zod'

const def = defineWorkflow({
  name: 'demo', version: '1',
  input: z.object({ seed: z.number() }),
  output: z.object({ total: z.number() }),
  body: async (ctx, input) => ({ total: (await ctx.step('bump', async () => input.seed + 1)) + 1 }),
})

// 在你的 Cordis 组合里挂载引擎插件，然后绑定定义：
await ctx.plugin(DurableEngine, { path: 'ledger.db' })
const workflow = await bind(def, ctx.durable)
const handle = await workflow.run({ seed: 1 }, { runId: 'demo-1' })
const { total } = await handle.result   // 类型化输出：{ total: number }
```

<a id="run-from-source"></a>

### 从源码运行

```sh
git clone https://github.com/0xnicholas/daypaw-pro.git
cd daypaw-pro
pnpm install
pnpm run build
```

产品壳源码态启动（需已构建 `lib/`，从仓库根目录运行，ledger 落在 `./daypaw/`）：

```sh
pnpm dev:daypaw              # 模型 key 解析顺序：--key 参数 > 环境变量 > 根 .env
```

上游 dsh Web UI 仍可直接使用：

```sh
pnpm dsh web
```

端到端可运行示例（含真 SIGKILL 续跑验证）见 [packages/examples/daypaw-skeleton](packages/examples/daypaw-skeleton/README.zh.md)。

## agents 目录

壳宿主的 agent 定义注册源是运行目录下的 `daypaw/agents/`（与 ledger 同域，每个工作区自带 agent 集与账本）。目录内文件的唯一形态是零裸导入的注入式工厂，由装载器 `@daypaw/sdk/agents-dir` 注入 SDK 命名空间（[ADR 0012](docs/adr/0012-shell-started-runs.md)）：

```js ignore-check
// daypaw/agents/starter-assistant.mjs —— 无 import；装载器注入命名空间
export default ({ defineAgent, z }) => defineAgent({
  name: 'starter-assistant', version: '1',
  input: z.object({ task: z.string() }), output: z.string(),
  prompt: [], tools: [],
  model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  maxTurns: 16, steerable: true,
})
```

CLI 首跑会幂等播种这个 starter agent（仅缺失时写入，永不覆盖），零 agent 文件的工作区也有可选。

## 仓库结构

- `packages/daypaw/` —— fork 产品家族：[`engine`](packages/daypaw/engine/README.zh.md)（durable 执行引擎）、[`store`](packages/daypaw/store/README.zh.md)（SQLite ledger 契约）、[`sdk`](packages/daypaw/sdk/README.zh.md)、[`cli`](packages/daypaw/cli/README.zh.md)、`web-app`（产品壳 bundle）、`ui-*`（壳浏览器插件）、`approval-history`（审批审计投影）。
- `apps/daypaw-web/` —— 产品壳前端。
- `docs/adr/`、`docs/spec/`、`CONTEXT.md`、`docs/fork/` —— fork 设计语料与登记（中文优先）。
- 其余目录（`packages/`、`apps/`、`vendor/`、`python/`、`native/` 等）为上游所有，布局见 [docs/architecture.zh.md](docs/architecture.zh.md)。

## 与上游同步

每 2–4 周或里程碑开工前执行同步仪式：从 upstream merge、全量测试、打 `daypaw-sync/<日期>` checkpoint tag（注释携带所合并的上游 commit sha），作为「当前基线」的唯一权威记录（[ADR 0001](docs/adr/0001-upstream-sync-strategy.md)）。对上游文件的修改默认禁止，例外须登记 [docs/fork/CORE_TOUCHES.md](docs/fork/CORE_TOUCHES.md)，并在每次 sync 逐条重放验证。

## 开发

- 入口文档：[开发指南](docs/development.zh.md)、[架构文档](docs/architecture.zh.md)、[领域词汇表](CONTEXT.md)。
- 常用命令：`pnpm run typecheck`、`pnpm run test`、`pnpm run check:ci:daypaw-hosted`（fork main 车道）、`pnpm run test:web:daypaw`（产品壳组装快照）。
- 面向 agent：遵循 [AGENTS.md](AGENTS.md)。
- 参与上游贡献：见 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)。

## 引用

本仓库基座来自 DeepSeek Harness：

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)，继承自上游。第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
