---
description: "自包含 daypaw CLI：npm i -g @daypaw/cli 安装 daypaw 命令——从打进本包的 vendored 运行时闭包直接启动产品壳，无需另装任何 @deepseek-ai/* 包。裸 daypaw 启动浏览器壳并打印 URL 行（daypaw w"
kind: "package-reference"
---

# @daypaw/cli

[English](README.md) | 中文

## 概述

## 目录



自包含 daypaw CLI：`npm i -g @daypaw/cli` 安装 `daypaw` 命令——从打进本包的 vendored 运行时闭包直接启动产品壳，无需另装任何 `@deepseek-ai/*` 包。裸 `daypaw` 启动浏览器壳并打印 URL 行（`daypaw web: http://127.0.0.1:<端口>`）；壳应用自己的参数紧随其后（`daypaw --port 8080`、`daypaw --help`）。durable ledger 落在启动目录的 `daypaw/ledger.db`。交付形态：[ADR 0011](../../../docs/adr/0011-customer-self-run-delivery.md)。

manifest 即 deploy root，其 `dependencies` 精确决定哪些 workspace 包进入 tarball（沿用 `python/sdk-runtime` 的 deploy-root 先例）。`bin.mjs` 在委托 `@deepseek-ai/dsh/lib/bin.js` 之前，先经 `src/index.ts` 播种 `daypaw` profile 并默认 launcher profile：裸调用（及裸 `plugin` 子命令）变为 `--profile daypaw`；显式带 `--profile`、或用 vendored `web` 别名（启动上游 web profile）的调用原样透传，dsh launcher 完整语法仍可达。首跑物化 `$DSH_HOME/profiles/daypaw`（bundles 为 `@deepseek-ai/dsh-base` + `@daypaw/web-app`，`@daypaw/engine` 行播进 profile 自己的 `cordis.patch.yml`）；旧版 CLI 播种过的 profile 在其 bundles 仍与出厂元组完全一致时迁移到壳元组。每次启动从本包自身依赖闭包把 daypaw 家族平铺 heal 进安装 fallback（`$DSH_HOME/profiles/node_modules`）——launcher 的 heal 只覆盖 dsh app 闭包——使组合树点名的每个 `@daypaw` 行都可解析，且 profile 内的 pnpm 操作无法剪掉这些链接。播种幂等、永不覆盖用户文件。同一次启动还会播种工作区的 starter agent——`daypaw/agents/starter-assistant.mjs`，与 per-workspace ledger 同目录，仅缺失时写入（ADR 0012）——用户尚未自著任何 agent 时新任务弹窗也有可选。打包由 `scripts/release/daypaw.ts`（`pnpm run release:daypaw`）负责：deploy 前构建前端 dist、deploy 闭包、把 workspace range 改写为真实版本、以 `bundleDependencies` 打包，并以从全新 home 裸启 `daypaw` 到 URL 行并被服务到 dist 页面作为 tarball 冒烟。

## 可发布例外

`@daypaw/*` 家族默认 `private: true` / 版本 `0.0.0`（见[新增 daypaw 包清单](../../../docs/fork/adding-a-daypaw-package.md) §1）。`@daypaw/cli` 与 `@daypaw/sdk` 是 ADR 0011 核准的两个可发布例外：它们在自己的 artifact 版本线上携带真实 `0.x` 版本号、`publishConfig.access: public`，并在消费方必须自备的包上使用面向 npm 的 peer range。

## Model Experience

### Stored domain records

#### What the model sees

无。本包是分发外壳；一切模型可见行为归经 `bin.mjs` 触达的 vendored dsh 包。

#### Token effect

零实时请求 token。

#### KV Cache effect

无——本包不触碰实时请求前缀。

## Known Limitations and Deferred Work

- **宿主机平台闭包**——tarball 打包的是构建宿主机上 deploy 出的闭包；宿主之外的平台特定 native 依赖在安装时从 npm 解析，无已发布 native 兜底的平台未测试。
- **单发 headless 不是本 CLI 的面**（spec 05 §4）——壳即产品；程序化 durable 运行走 `@daypaw/sdk`，或显式 `--profile` 启动上游 headless profile。
- **播种仅限 CLI**——`daypaw` profile 模板在本包内，不在上游 launcher 的 `PROFILE_TEMPLATES` 里，源码态 `pnpm dsh --profile daypaw` 不会自初始化；源码态组合请改用 [examples/daypaw-skeleton](../../../packages/examples/daypaw-skeleton/README.zh.md)。
- **不承诺跨版本续跑在飞 run**——按 ADR 0011 §2，升级须先 drain ledger 或弃库重跑。
- **无 `NPM_TOKEN` 时发布路径未验证**——release workflow 的 publish job 依赖该 secret；受门验证的是 pack 路径。

### 开发备注
