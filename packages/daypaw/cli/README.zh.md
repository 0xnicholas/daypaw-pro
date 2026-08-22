# @daypaw/cli

[English](README.md) | 中文

自包含 daypaw CLI：`npm i -g @daypaw/cli` 安装 `daypaw` 命令——从打进本包的 vendored 运行时闭包启动 dsh CLI，无需另装任何 `@deepseek-ai/*` 包。单任务运行：`daypaw --profile daypaw "<task>"`；durable ledger 落在启动目录的 `daypaw/ledger.db`。交付形态：[ADR 0011](../../../docs/adr/0011-customer-self-run-delivery.md)。

manifest 即 deploy root，其 `dependencies` 精确决定哪些 workspace 包进入 tarball（沿用 `python/sdk-runtime` 的 deploy-root 先例）。`bin.mjs` 在委托 `@deepseek-ai/dsh/lib/bin.js` 之前，先经 `src/index.ts` 播种 `daypaw` profile：首跑物化 `$DSH_HOME/profiles/daypaw`（bundles 为 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`，`@daypaw/engine` 行播进 profile 自己的 `cordis.patch.yml`），并把闭包内的 engine 软链进 profile 的 `node_modules`——launcher 维护的模块 fallback 只覆盖 dsh app 的依赖闭包。播种幂等、永不覆盖既有文件。打包由 `scripts/release/daypaw.ts`（`pnpm run release:daypaw`）负责：deploy 闭包、把 workspace range 改写为真实版本、以 `bundleDependencies` 打包，并以从全新 home 用 `--profile daypaw` 启动到缺凭据线作为 tarball 冒烟。

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
- **播种仅限 CLI**——`daypaw` profile 模板在本包内，不在上游 launcher 的 `PROFILE_TEMPLATES` 里，源码态 `pnpm dsh --profile daypaw` 不会自初始化；源码态组合请改用 [examples/daypaw-skeleton](../../../examples/daypaw-skeleton/README.md)。
- **不承诺跨版本续跑在飞 run**——按 ADR 0011 §2，升级须先 drain ledger 或弃库重跑。
- **无 `NPM_TOKEN` 时发布路径未验证**——release workflow 的 publish job 依赖该 secret；受门验证的是 pack 路径。
