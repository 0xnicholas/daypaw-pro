# Agent Note: daypaw self-contained npm delivery — closure-manifest packaging and its pnpm-deploy hazards

Status: implemented

[English](2026-08-22-daypaw-npm-self-contained-delivery.md) | 中文

## Problem

ADR 0011 裁定 v1 客户交付为两个自包含 npm 包（`@daypaw/cli`、`@daypaw/sdk`），走 vendored 闭包 tarball 路线，spike 已端到端证实。剩下的是把 spike 的一次性脚本变成有属主的发布工程，同时满足仓库包门——它们假设每个 `packages/*/*` 包都是 private、workspace 接线、带 invariant 伴随包——并化解 spike 暴露的三个 pnpm-deploy 险情。

## Decision

- **`packages/daypaw/cli` 是闭包 manifest 包**：无产品代码，只有 deploy-root manifest（dependencies = `@deepseek-ai/dsh` 加上 legacy deploy 会丢弃的全部 peer-only Service Definition 包，沿用 `python/sdk-runtime` 先例）、导入 `@deepseek-ai/dsh/lib/bin.js` 的 `bin.mjs` shim，以及包门要求的解释性空 invariant 伴随包。它与 `@daypaw/sdk` 是家族仅有的两个可发布例外（真实 `0.x` 版本、`publishConfig.access: public`）；`check-workspace-constraints` 携带具名豁免集，sdk 的 npm range peer 在 workspace 协议与 invariant 门的 `workspace:^` 规则上各有一条豁免，全部登记于 `docs/fork/CORE_TOUCHES.md`。
- **sdk 的消费方自备单例用 npm range peer**：`@deepseek-ai/cordis` `~4.0.1`、`@deepseek-ai/dsh-invariants` `~0.1.0-rc.3`（下限 = 不超过 vendored 副本的最新已发布 rc，按 ADR 0011 §2 补记），zod `^4.4.3` 移出 dependencies 让消费方共享单份。sdk 再导出 `DurableEngine`，消费方不再 `createRequire` 进 vendored 闭包；`@daypaw/engine`/`@daypaw/store` 保持 private，只随 sdk tarball 分发。
- **`scripts/release/daypaw.ts` 拥有流水线**（`pnpm run release:daypaw`）：先构建两个 face，再逐包 `pnpm deploy --legacy --prod`（spike 的 flag 组），按内容复制暂存树（deploy 硬链接 workspace 文件——就地改写会写穿回仓库），对 `dependencies`+`peerDependencies` 做 BFS 闭包检查（尊重 `peerDependenciesMeta.optional` 与 sdk 三个刻意外挂的 peer），从仓库来源回补被丢弃的包，改写 manifest（`workspace:` → 暂存版本；cordis peer → `~` range；剥掉 devDependencies；`bundleDependencies` = 暂存闭包），`npm pack`，然后两道 smoke：干净 prefix 全局安装 CLI 并启动到无 API key 报错行；registry 安装的 SDK 消费方在 NodeNext 下 typecheck 并跑通一个 workflow 拿到类型化结果。`--publish` 发布；默认只打包。
- **`.github/workflows/release-daypaw.yml`** 在 PR 与 main 推送上无密钥跑 pack + smoke；publish job 仅在手动 dispatch 且 `publish=true`、配置 `secrets.NPM_TOKEN` 时运行。

三个 pnpm 险情及其处置（作为长期事实重述）：legacy deploy 会漏掉 peer-only 与部分传递包（cli manifest 显式声明它们；闭包检查证明完整）；deploy 硬链接使原始暂存树实际上只读（流水线改写内容副本）；deploy 在源包 node_modules 留下的残留会让下一个 `pnpm run` 要求交互式 `--production` 清除（`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`），因此脚本在任何 deploy 之前构建，开发树在手动 deploy 后用一次 `pnpm install` 修复。

## Alternatives considered

- **CLI 单文件打包** —— ADR 0011 已否决：cordis loader 运行时动态 import 插件包名，bundler 看不到闭包。
- **自行发布 `@deepseek-ai/*` scope** —— ADR 0011 已否决：scope 属上游；把闭包 vendored 进 `@daypaw/*` tarball 绕过之，上游包零改名。
- **cordis 与 dsh-invariants 也打进 sdk tarball** —— 否决：消费方把引擎挂进自己的 Cordis app，打进第二份 cordis 会破坏 service 单例；fork 的 vendor/ 与上游已发布版本字节一致，npm range 安全。
- **zod 保持为打包进的 sdk 依赖** —— 否决：消费方应用自己的契约已带 zod；钉死的打包副本造成重复并分裂类型同一性。

## Consequences

- pack 路径全门控（workflow 每个 PR 都跑）；publish 路径需要的 `NPM_TOKEN` secret 尚未配置，`npm publish` 从未真实执行——首次发布前先跑一次 `npm publish --dry-run`。
- CLI tarball 打包构建宿主机的平台闭包；宿主之外的平台特定 native 依赖安装时从 npm 解析，无已发布 native 兜底的平台未测试（cli README 限制节）。
- 日后 dsh CLI 的 peer-only 面新增任何包，必须在同一改动里加入 `packages/daypaw/cli/package.json` 的 dependencies；否则闭包检查让发布失败。
- spike 的 `build:lib:client` 崩溃已诊断为 deploy 残留触发的清除中止，而非 client face 缺陷：干净 `pnpm install` 状态下两个 face 均绿。
