# Agent Note: dsh-attachment 加入 sdk 消费方自备 peer

Status: implemented

[English](2026-09-10-sdk-attachment-consumer-peer.md) | 中文

## Problem

上游 `a3207a758b`（2026-08-29 同步窗口内落入）把 `packages/llm/llm/package.json` 里的 `@deepseek-ai/dsh-attachment` 从 peerDependencies 挪进 devDependencies。发布管道以 `--config.auto-install-peers=false` 取 `--prod` 闭包，attachment 随之不再被 stage，而闭包内 dsh-llm 的公开声明仍 import 它的类型（`AttachmentStore`、`FileAttachmentRef`、`ImageAttachmentRef`、`ImageMediaType`、`RequestImageAttachment`——全部仅类型引用）。打包出的 `@daypaw/sdk` 既不 bundle attachment、也不声明它为消费方 peer，注册表消费方的 `tsc` 在三个声明文件上 TS2307；Release（daypaw）车道自 2026-09-01 起 main 每次 push 皆红（issue [#110](https://github.com/0xnicholas/daypaw-pro/issues/110)）。CLI tarball 不受影响——file-upload 等会把 attachment 重新带进其闭包——手动 dispatch 的发布门从未被触及。

## Decision

- `@daypaw/sdk` 声明 `@deepseek-ai/dsh-attachment` `~0.1.3-alpha.2` 为消费方自备 peer，与 cordis、zod 并列（ADR 0011 §2 补记，2026-09-10）。该依赖仅类型引用：没有运行时单例需要归一，只有声明需要可解析。
- range 下限取「承载闭包内 dsh-llm 声明所 import 面」的最小已发布版本：`FileAttachmentRef` 与 `RequestImageAttachment` 仅自 `0.1.3-alpha.2` 起存在——`0.0.1-rc` 线与 `0.1.0`/`0.1.1`/`0.1.2` 线均缺——且 `0.1.3-alpha.2` 的导出集与 vendored `0.1.3-alpha.1` 逐项一致。prerelease 元组规则把 range 限制在 `0.1.3` prerelease 线加后续 `0.1.x` final 内。
- `SDK_EXTERNAL_PEERS` 纳入 attachment：闭包完整性检查允许部署根的该 peer 缺席，`rewriteManifests` 从同一清单推导不打包集（扣除保持 bundle 的 cordis 单例），把 attachment 与 zod 一并挡在 `bundleDependencies` 外——未来同步若把 attachment 重新带进 prod 闭包，也不能静默把 tarball 翻回 bundle 形态，清单新增 peer 自动随动。
- `smokeSdk` 改从 SDK 源清单推导消费方的 peer 安装集（zod 经 `externalPeerPins` 钉版），不再硬编码 cordis/zod range：每个已发布 peer 都按客户形态被演练，range 漂移先红冒烟而不是红客户。

## Alternatives considered

**把 attachment 作为 SDK 真依赖 bundle**（上游 peer→dev 挪动前的形态）。否决：bundle 副本与消费方经 peer 安装的副本构成同名第二身份；对仅类型引用而言它只是遮蔽消费方的解析，并破坏「消费方同时直用上游 dsh 包」时的 peer 契约。

**按 ticket 草案的 peer range `^0.0.1-rc.1`**（镜像更早的上游 llm 发布）。经实证否决：该 range 解析落在 `0.0.1-rc` 线内，其面缺 `FileAttachmentRef`/`RequestImageAttachment`；冒烟消费方 TS2614/TS2724。上游当前已发布的 `dsh-llm@0.1.5-rc.1` 已不再把 attachment 声明为 peer（devDependency `^0.1.5-rc.1`），没有上游 peer 声明可镜像——锚点只能是 vendored 面。

**像 zod 那样经 `externalPeerPins` 钉版 attachment。** 否决：zod 钉版的存在前提是 zod 在 semver 兼容 range 内改泛型形状；attachment 的 range 本身已确定性解析（今天只匹配 `0.1.3-alpha.2`），且冒烟 typecheck 守漂移——`0.0.1-rc` 面缺口正是这样在本次修复中暴露的。

**pack 后对 bundle 集合做「声明的 types import 全部可解析」断言**（ticket 的可选防线，另行裁决）。本次不做：冒烟 typecheck 已在同一车道步骤拦下这一失败类。

## Consequences

- `pnpm run release:daypaw` 本地端到端退出 0：CLI 冒烟不变（起 shell 至 URL 行、供 dist、播种 profile、挂引擎 ledger）；SDK 冒烟从注册表装 `@deepseek-ai/dsh-attachment@0.1.3-alpha.2`，NodeNext 下 typecheck 通过并跑出 `RESULT {"total":50}`。tarball 声明该 peer 且不含任何 attachment 路径（`bundleDependencies` 22）。
- pnpm 的 auto-install-peers 在 `pnpm-lock.yaml` 里为 SDK importer 供给注册表 `0.1.3-alpha.2` 作为隐藏 peer 依赖（仅开发上下文；deploy 传 `--config.auto-install-peers=false`，它进不了 tarball）。
- 同步仪式：同步移动 vendored attachment 类型面时，peer range 随「承载该面的最小已发布版本」走；SDK 冒烟 typecheck 是先红的门（登记于 ADR 0011 §2）。
- 残余风险：消费方在 range 内解析到高于 vendored 面的 attachment（更晚的 `0.1.3` prerelease 或 `0.1.x` final）时，依赖上游保持该面只增不破；冒烟证明的是解析到的版本，不是整个 range——与 zod 钉版携带的残余同形（见[完整性 note](2026-08-30-release-tarball-completeness.zh.md)）。

相关：[自含交付 note](../process/2026-08-22-daypaw-npm-self-contained-delivery.zh.md) 拥有本变更所扩展的管道决策。
