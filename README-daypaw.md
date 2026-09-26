# README-daypaw — daypaw fork 前门

> 本页只做定位陈述与入口导览，不复述内容。事实各归其家：词汇 = [CONTEXT.md](CONTEXT.md)，架构决策 = [docs/adr/](docs/adr/)，设计规格 = [docs/spec/](docs/spec/)，fork 程序与上游改动登记 = [docs/fork/](docs/fork/)，架构现状报告 = [docs/reports/](docs/reports/)，包族契约 = [packages/daypaw/README.md](packages/daypaw/README.md)。

## 这是什么

daypaw-pro 是 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的 fork + in-tree 扩展。上游提供 agent 会话引擎底座（会话持久化、工具、Cordis 组合、Web 壳）；fork 的产品 family 全部住在新目录——[packages/daypaw/](packages/daypaw/README.md) 与 `apps/daypaw-web/`——不改 `agent-loop` 等上游核心。

定位（ADR 0013）：「持久执行 + agent 的日常驾驶舱」。业务语言壳是默认皮肤，专业视图（trajectory 检查器、verbatim 工具卡）按需展开；能力底座全开，敏感操作必审批。四支柱中现役 ① Durable Execution 与 ② Agent Engine + SDK；③ Agent Manager 与 ④ EVO 为远期独立子项目（ADR 0009）。

## 包族速览

| 包 | 职责 |
|---|---|
| [`@daypaw/store`](packages/daypaw/store/README.md) | 中性 SQLite ledger 契约：run / step / effect / promise / timer 的追加式事实日志 |
| [`@daypaw/engine`](packages/daypaw/engine/README.md) | durable 引擎，经 Cordis 插件族暴露 `ctx.durable`：run 幂等 start-or-attach、step 幂等去重、boot 扫描复活、durable promise、每 run 单写者认领 |
| [`@daypaw/sdk`](packages/daypaw/sdk/README.md) | 代码优先编程模型：`defineAgent`（声明式 LLM 循环 spec）与 `defineWorkflow`（代码编排体，`ctx.step/sleep/waitFor/agent/spawn` 五原语）；输出经 zod 校验类型化 |
| [`@daypaw/cli`](packages/daypaw/cli/README.md) | 自含交付：`daypaw` 命令直起浏览器壳 |
| [`@daypaw/web-app`](packages/daypaw/web-app/README.md) + `ui-*` + `apps/daypaw-web` | 产品壳：任务板、任务对话、agent 目录、设置、审批待办与前端 |
| [`@daypaw/approval-history`](packages/daypaw/approval-history/README.md) | 审批审计投影 |

引擎子系统专页：[docs/subsystems/daypaw-engine.md](docs/subsystems/daypaw-engine.md)。

## 与上游 dsh 的关系

- **冻结姿态**（[ADR 0019](docs/adr/0019-freeze-posture.md)）：上游是依赖而非权威，整体 merge 不再执行。准入只有三层：dependabot 安全更新（直接进 lockfile）、按需 cherry-pick（`packages/llm/**` 的 provider 适配与安全类提交）、永不执行的定期 merge。`upstream` remote 保留为 fetch-only；`daypaw-sync/<日期>` 四个 tag 保留为历史记录。
- **core-touch 记录**：默认仍不修改上游文件；一切例外登记在 [docs/fork/CORE_TOUCHES.md](docs/fork/CORE_TOUCHES.md)，标注性质（`通用改进` / `fork 取舍` / `fork 登记`）。登记是差异记录，没有重放义务。
- **经缝扩展**：新包族、merge-extensible 事件、patch-layer（`cordis.patch.yml`）组合是首选挂载点。
- **交付独立**（ADR 0011）：`@daypaw/*` 走独立 0.x 版本线；`@daypaw/cli` 与 `@daypaw/sdk` 为自含单包（上游 `@deepseek-ai/*` 依赖打包进包、零改名）。
- **依赖更新**：fork 停用 dependabot 版本更新（`.github/dependabot.yml` 三个 ecosystem 各一行 `open-pull-requests-limit: 0`）；安全更新保留并直接进 lockfile，其余依赖经 ADR 0019 §1 第 2 层人工评估进入（[ADR 0017](docs/adr/0017-dependency-update-posture.md)）。

## 快速上手

源码运行（Node ^22.19 || >=24，pnpm workspaces）：

```sh
pnpm install
pnpm run build        # daypaw 包从 lib/ 执行，源码态先构建
pnpm dev:daypaw       # 在空闲端口拉起产品壳（默认 3080），打印 launch-token URL
```

`dev:daypaw` 须在仓库根运行；可加 `--build`（先跑全量构建）、`--open`（打开浏览器）、`--port N`、`--key <DEEPSEEK_API_KEY>`。模型 key 解析顺序 `--key` > `DEEPSEEK_API_KEY` > 根 `.env`；缺 key 可启动，模型调用按请求失败。

外部自跑交付（ADR 0011）：CLI 层 `@daypaw/cli`（直接运营平台的使用者）、库层 `@daypaw/sdk`（嵌入自己应用的开发者）；发布流程入口 `pnpm run release:daypaw`；首次发布／换 token 的凭据设置走向导 `bash scripts/release/publish-daypaw.wizard.sh`。本机跑完 `release:daypaw` 要补跑一次 `pnpm install`：pnpm deploy 的 hoist 残留会让下一次 `pnpm run` 要求交互式 purge（CI 每次全新检出，不受影响）。

## 导览

- 词汇与边界：[CONTEXT.md](CONTEXT.md)
- 架构决策记录：[docs/adr/](docs/adr/)
- 设计规格：[docs/spec/](docs/spec/)
- fork 程序（CORE_TOUCHES 登记、加包 cookbook）：[docs/fork/](docs/fork/)
- 架构现状报告：[docs/reports/](docs/reports/)
- 包族契约：[packages/daypaw/README.md](packages/daypaw/README.md)；引擎子系统页：[docs/subsystems/daypaw-engine.md](docs/subsystems/daypaw-engine.md)
