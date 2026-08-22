# CORE_TOUCHES.md — 上游文件改动登记

每登记一条：文件、原因、「上游 PR 候选？」标记。每次同步仪式（ADR 0001）逐条重放验证；被上游接受的改动在下一次 sync 后划掉。

| 文件 | 改动 | 原因 | 上游 PR 候选？ | 登记批次 |
|---|---|---|---|---|
| `AGENTS.md` | 文末追加「daypaw-pro (fork layer)」节（issue tracker / triage labels / domain docs 指引） | pi 项目指引须随 AGENTS.md 自动加载；上游段落保持原样、上游所有 | 否（fork 私有流程） | A（fork 导入） |
| `tsconfig.base.json` | paths 新增 `@daypaw/*` 与 `@daypaw/*/invariant` 两个通配组（daypaw 新 family 的源解析） | 新 family 纯新增的共享配置加性例外（ADR 0001/ADR 0006；加包清单 §2 预期项） | 可提（上游无 daypaw，但通配组模式可参考） | C（走骨） |
| `tsconfig.host.json` | references 新增 `packages/daypaw/{store,engine,sdk,cli}` 四行（host 聚合，daypaw 无 client 侧包） | 同上；项目引用无通配形式，只能逐包登记 | 可提（同上） | C（走骨） |
| `scripts/check-workspace-constraints.ts` | release-member 目录正则排除 `packages/daypaw/` 组（负向前瞻）；另设 `publishableDaypawPackages`（cli/sdk）：豁免 private 要求、改验 `publishConfig.access: public` 与 fork 仓库 repository 字段，并豁免其 peerDependencies 的 workspace: 协议要求 | 上游 npm-public 化后 `packages/*/*` 一律要求可发布，与 ADR 0001「@daypaw 独立 0.x private」相抵；ADR 0011 核准 cli/sdk 两包可发布、peer 指向上游 npm 发布 | 可提（上游无 daypaw；规则形状属上游发布流程） | C（走骨）/D（客户交付） |
| `scripts/package-invariants.ts` | `@daypaw/sdk` 豁免 dsh-invariants peer 必须为 `workspace:^` 一条（dev 仍验） | ADR 0011：sdk 发布时该 peer 是面向消费方的 npm range，workspace 接线留在 devDependencies | 否（fork 发布形态无上游对应物） | D（客户交付） |
| `knip.json` | workspaces 新增 `packages/daypaw/cli`：entry/project 同规约 + `ignoreDependencies: @deepseek-ai/.+` | cli 是闭包 manifest 包，dependencies 列表刻意不被代码引用（同 apps/cli 先例） | 否（fork 私有包） | D（客户交付） |
| `package.json`（root） | scripts 新增 `release:daypaw`（`tsx scripts/release/daypaw.ts`） | ADR 0011 发布工程面入口 | 否（fork 私有流程） | D（客户交付） |
| `.gitignore` | 新增 `dist-daypaw/`（release 暂存与 tarball 输出） | 同 `dist-exe/` 先例 | 否（fork 私有产物） | D（客户交付） |
| `scripts/doc-budgets.manifest.json` | `AGENTS.md` 词预算 1900 → 1975 | 上游本体已顶满 1900，任何 fork layer 追加都超限；提上限而非持续压缩上游段落 | 否（fork 层增量无上游对应物） | C（走骨） |
| `scripts/translation-pairing.ts` | 翻译范围排除 fork 设计语料（docs/{adr,spec,agents,fork,reports,research}、CONTEXT.md） | fork 设计语料中文优先是图定决策（map #1），双语义务覆盖上游文档 | 否（fork 语料无上游对应物） | C（走骨） |
| `scripts/gen-cordis-catalog.ts` | `ctx.durable` 入 SERVICE_WALK_EXEMPTIONS；EngineDefinition/EngineRunHandle/EngineRunOptions 入 TYPE_LINK_EXEMPTIONS | fork 服务的文档之家是包 README（上游子系统目录外），签名类型链接随之豁免 | 可提（豁免模式本身是上游机制；具体条目属 fork） | C（走骨） |
