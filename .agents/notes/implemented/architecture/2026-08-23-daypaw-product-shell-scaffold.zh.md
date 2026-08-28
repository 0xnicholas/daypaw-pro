# Agent Note: daypaw 产品壳脚手架——路线 B 前端与胶水 bundle

Status: implemented

[English](2026-08-23-daypaw-product-shell-scaffold.md) | 中文

## 问题

[spec 第 5 章](../../../../docs/spec/05-product-shell.md) §4 为产品壳裁决了路线 B：fork 通过自己的胶水 bundle 托管自己构建的前端 dist，镜像上游 `apps/web` + `packages/bundle/web-app` 这对组合。悬而未决的实施问题是脚手架究竟承载上游这对组合的多少——全量拷贝会把开发者向的浏览器 roster 拖进产品壳，而裁剪拷贝会在拥有 roster 移除决策的板块票（#56–#60）存在之前就把组合图搞坏。

## 决定

落地两个新的 workspace 包作为 fork 载体：

- **`apps/daypaw-web`（`@daypaw/web-frontend`）**——镜像 `apps/web` 的私有 vite 入口：相同的 alias、分包与 `window.__DSH_BOOT__` 拒绝逻辑，只带 fork 身份（包名/repository、`daypaw` 标题与 manifest、daypaw 语境的 standalone-serve 报错）。上游的 e2e/压力测试泳道不复制，仍归上游所有。
- **`packages/daypaw/web-app`（`@daypaw/web-app`）**——镜像 `packages/bundle/web-app` 的私有胶水 bundle。spec §4 裁决的四点差异中三点照原文落地：`resolveDistIndex()` 解析 `@daypaw/web-frontend/dist/index.html`；`webSurfacePrompt()` 用 daypaw 语境（并声明本壳未接重建 watcher）；URL 行打印 `daypaw web:`。第四点——`DAYPAW_WEB_URL` 改名——**暂缓**：受管 shell 变量生活在保留的 `DSH_*` 命名空间（`shell-env` 在注册时拒绝其他前缀，`dsh-subprocess` 会从子进程环境剥掉 ambient `DSH_*`），不改宽上游契约就无法通过该注册表；暂由 `DSH_WEB_URL` 顶位（见包 README 的 Known Limitations）。两个 bundle 从不同时加载的可观察键保持上游取值：插件名 `web-app`/`web-startup`/`web-app-invariant`、prompt section `app:web-surface`、shellEnv 注册名 `web-runtime`、服务 `webStartup`/`webRuntime`。
- **roster 占位裁决**——fork 的 `cordis.patch.yml` 把上游浏览器 roster 保留为占位，使组合端到端可启动；ui-sidebar 行此后已被 fork 的 `ui-inbox` 替换（issue #55，[壳 IA 骨架](../feature/2026-08-24-daypaw-shell-ia-skeleton.zh.md)），其余壳不交付的行的移除与重写版换入仍归板块票（#56–#60），`DAYPAW_PROFILE_BUNDLES` 在 profile 接线票（#61/#62）之前不动。

共享上游文件只做追加式编辑，逐条登记在 [CORE_TOUCHES.md](../../../../docs/fork/CORE_TOUCHES.md)：`scripts/check-workspace-constraints.ts` 的 `apps/daypaw-*` 发布成员排除、`tsconfig.base.json` 的一条 `@daypaw/web-app/startup` paths 项、每个聚合各一条 references 行、`build:web` 扩展，以及两处 knip workspace 条目。

duplication 处理：jscpd 门禁只扫 `packages` 和 `scripts`，`apps/daypaw-web` 无需豁免；三个胶水源码是有意镜像，携带注明 fork 载体理由的 `jscpd:ignore-start/end` 块，沿用 `packages/daypaw/*/src/invariant.ts` 先例。既有的红色基线（#47 记录的 `app-boot/profile.ts` vs `daypaw/cli/index.ts` clone）不因本次工作改变。

## 否决的备选

- **脚手架期就裁剪 roster**——否决：移除是板块票自己的决策（#56–#60）；在此剪行既抢占那些裁决，又会在上游行相互依赖处把脚手架弄得无法启动。
- **改可观察键名**（插件名、prompt section、shellEnv 注册名）——否决：两个 bundle 从不在同一组合里加载，键不可能冲突，改名没有收益，只会与 fork 跟踪的上游胶水产生漂移。
- **只给完全相同的段落包 jscpd 豁免**——否决：四点差异嵌在镜像体内部，局部豁免会碎成逐函数的豁免块；整文件一个块加载体理由只命名一次关系，与既有 daypaw invariant 同伴一致。

## 后果

- `pnpm run build` 现在同时产出 `apps/daypaw-web/dist`，胶水经 package exports 解析它；三个镜像 spec（真实 Loader 树上的 startup provider、LAN trust 采样、运行时胶水）与新包的 per-file coverage 全绿。
- fork web 面尚不能从 `daypaw` CLI 到达：profile 接线（`DAYPAW_PROFILE_BUNDLES`）属 #61/#62，因此只有显式挂载 `@daypaw/web-app` 的组合才能起壳。
- 今后的每次上游同步都要对 `packages/bundle/web-app` 重放这四点差异；上游胶水变动时 fork 载体必须重新应用它们。
