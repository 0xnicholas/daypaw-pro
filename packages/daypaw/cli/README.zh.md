# @daypaw/cli

[English](README.md) | 中文

自包含 daypaw CLI：`npm i -g @daypaw/cli` 安装 `daypaw` 命令——从打进本包的 vendored 运行时闭包启动 dsh CLI，无需另装任何 `@deepseek-ai/*` 包。交付形态：[ADR 0011](../../../docs/adr/0011-customer-self-run-delivery.md)。

本包不含产品代码：manifest 即 deploy root，其 `dependencies` 精确决定哪些 workspace 包进入 tarball（沿用 `python/sdk-runtime` 的 deploy-root 先例）；`bin.mjs` 是从闭包导入 `@deepseek-ai/dsh/lib/bin.js` 的 shim。打包由 `scripts/release/daypaw.ts`（`pnpm run release:daypaw`）负责：deploy 闭包、把 workspace range 改写为真实版本、以 `bundleDependencies` 打包。

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
- **不承诺跨版本续跑在飞 run**——按 ADR 0011 §2，升级须先 drain ledger 或弃库重跑。
- **无 `NPM_TOKEN` 时发布路径未验证**——release workflow 的 publish job 依赖该 secret；受门验证的是 pack 路径。
