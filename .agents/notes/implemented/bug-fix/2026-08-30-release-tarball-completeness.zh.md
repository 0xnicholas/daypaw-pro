# Agent Note: 发布 tarball 闭包完整性与冒烟稳健性

Status: implemented

[English](2026-08-30-release-tarball-completeness.md) | 中文

## Problem

恢复不动点落地(#68)后,`Release (daypaw)` 走过闭包与打包,在 CLI 冒烟失败:安装的 tarball 能启动,但插件装载死于 `Cannot find package '@deepseek-ai/dsh-settings'`(由 `dsh-agent-presets` 引入)、`@deepseek-ai/dsh-credentials`(由 `dsh-client-connection` 引入)、`@deepseek-ai/dsh-jobs`(由 `dsh-jobs-local` 引入)。三者都已暂存并列于 `bundleDependencies`,tarball 内却是零文件。其后 SDK 冒烟的消费者类型检查又以 zod 泛型不匹配失败:registry 漂移到了 zod 4.5.2,而 SDK 捆绑类型是按工作区的 4.4.3 构建的。

## Decision

- `rewriteManifests` 对 CLI 与 SDK 共用同一段逻辑,把每个捆绑名按其已暂存版本钉入 `dependencies`(SDK 分支原本如此,循环现已共用)。npm 11 只在名字同时是真实依赖时才打包 `bundleDependencies` 项——用 scratch 门面验证:仅 `bundleDependencies` 打出 1 个文件,加上 `dependencies` 项才打包子包。sync 使 `dsh-settings`/`dsh-credentials` 成为捆绑插件的传递需求(被 import 而非门面依赖),缺钉因此才暴露。
- `missingClosurePackages` 改为按需求跟踪而非首次目击:一个名字只有当每个声明它的已到达 manifest 都允许缺席(可选 `peerDependenciesMeta` peer,或部署根外部 peer)时才可缺席;在一处可选、在另一处必需的名字视为必需。`dsh-jobs` 在 `dsh-api-session-controller` 处可选、在 `dsh-jobs-local` 处是硬 peer;旧的 `seen` 集短路让最弱约束获胜,恢复从未将其暂存。已暂存的可选包同样被遍历,其自身依赖因此受检。
- SDK 冒烟消费者把 zod 钉到仓库解析出的版本,而非 `^4.4.3`。zod 在 semver 兼容区间内改泛型形状,浮动的冒烟区间会因与 diff 无关的 registry 漂移而失败;SDK 的 zod 契约是被测试的版本,发布的 peer 区间继续承诺区间。

## Alternatives considered

**CLI 仅靠 `bundleDependencies`。** 否决:该 npm 行为已不存在;打包结果才是契约,而它要求 `dependencies` 钉入。

**完整性 BFS 遍历 `optionalDependencies` 边。** 否决:按 readdir 遍历已覆盖已暂存的可选包(deploy 提升到顶层),可选包的缺席仍合法;遍历该边会强制暂存 tarball 有意省略的包。

**为未来 4.x 放宽 SDK 的 zod 类型面。** 否决:这些形状是 zod 内部的;可测契约是钉定版本加发布区间。

## Consequences

- CLI tarball 携带 594 个捆绑闭包 manifest(50.9 MB),干净前缀冒烟中可启动;SDK 冒烟类型检查并通过运行(`RESULT {"total":50}`);`pnpm run release:daypaw` 本地端到端 exit 0。
- 已记录的残余风险:消费者解析到比测试钉定更新的 zod 时,仍可能撞上 SDK 类型的泛型形状不匹配;peer 区间承诺的兼容性只在钉定版本上验证过。
- `daypaw-closure.spec.ts` 钉住新语义:一处可选、一处硬性的名字被报告缺失;已暂存可选包自身的缺失依赖被报告。
