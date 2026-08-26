# Agent Note: daypaw profile template — seeded by the CLI bin, not the upstream template registry

Status: implemented

[English](2026-08-22-daypaw-profile-template-seeding.md) | 中文

## Problem

ADR 0011 把 `daypaw` profile 的首跑自初始化列为首个公开发布前的最后一块，spec 00 §3 已固定组合面：base bundle 加一行 `@daypaw/engine` 配方（`path: daypaw/ledger.db`）。dsh launcher 只为硬编码在 `PROFILE_TEMPLATES`（`packages/boot/app-boot/src/profile.ts`，上游文件）里的两个 profile 自初始化，daypaw 模板因此需要一个家：改那个注册表（core touch），还是走 `@daypaw/cli` 自有的 seam 路线。两个机械事实约束了选择：launcher 维护的模块 fallback 只镜像 dsh app 的依赖闭包，不加额外接线时 `@daypaw/engine` 从任何 profile 都不可被 Loader 解析；daypaw bin（`bin.mjs`）本就委托 vendored dsh bin，CLI 包因此拥有一个完全自有的预引导挂钩。

## Decision

- **模板随 `@daypaw/cli` 包自带，由 bin 播种**（`src/index.ts`，构建为 `lib/index.js`）：`bin.mjs` 在导入 dsh bin 之前运行 `seedDaypawProfile()`，首跑物化 `$DSH_HOME/profiles/daypaw`——经 launcher 自有的 `initProfile` 写 manifest（bundles 为 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']`），并先把 engine 配方以 `- insert:` 行写进 profile 的 `cordis.patch.yml`，使初始化器的永不覆盖规则保留该内容。`PROFILE_TEMPLATES` 的两个上游条目原样不动，模板决策因此仍在交付线的零 core-touch 性质（ADR 0011 §1）之内；engine 链接的 heal 后来成为唯一登记在册的例外，改为共享 launcher 的 `ensureSymlink` 导出（[共享 note](2026-08-26-ensure-symlink-shared-from-app-boot.md)）。
- **engine 行刻意走用户 patch 层**：组合面就是客户可以就地调参或删除的一行；播种永不重写既有 profile——被删的行保持被删。
- **engine 链接是 heal 而非安装**：每次启动把闭包内的 `@daypaw/engine` 软链进 profile 的 `node_modules`（错误或悬空的链接被重指；真实目录则 fail loud），经 launcher 自己导出的 `ensureSymlink` 完成。播种不跑 pnpm install，首跑保持离线可用。
- **覆盖**：`packages/daypaw/cli/tests/seed-profile.spec.ts` 把播种出的模板走真实 Loader 组合（播种 → `loadProfile` → `composeEntries` → 组合出的 engine 行挂载并跑完一次 run）；release 冒烟从全新 `DSH_HOME` 用 `--profile daypaw` 启动打包 tarball 到缺凭据线，断言播种出的 profile 与启动 cwd 下的 ledger。打包流水线归[交付 note](../process/2026-08-22-daypaw-npm-self-contained-delivery.md)。

## Alternatives considered

- **`PROFILE_TEMPLATES` 加 `daypaw` 项（core touch）**——否决：这在当时将是对上游 shipped runtime 文件的第一处改动（彼时登记的 core touch 全是仓库配置或工具），破坏交付线的零 core-touch 承诺，并成为上游同步仪式的永久重放项。其唯一额外收益——源码态 `pnpm dsh --profile daypaw` 也能自初始化——不在发布验收内。（heal 后来接受了唯一登记在册的运行时源文件例外，见上文共享 note。）
- **`@daypaw/engine` 作为自 bundle**（engine 自带 `dsh.bundle.patch`，模板把它列进 profile 的 bundles）——否决：模板仍需要播种器或注册表项来指名 bundle 列表，且产品行被移进包 patch、脱离客户触手可及的覆盖层；用户层播种让单行配方在覆盖本就所在的地方保持可见可改。
- **随包附带静态 `profile-template/` 目录、播种时拷贝**——否决：`initProfile` 已拥有 manifest 与 pnpm 设置的内容；在第二个静态家里重复它们招致漂移。只有 patch 层是 daypaw 自有内容，因此它是唯一播种的字符串。

## Consequences

- 「profile 模板」有了第二个家：上游 `PROFILE_TEMPLATES` 管 web/headless，`@daypaw/cli` 的播种器管 daypaw。spec 00 §3 记录该分工，cli README 的限制节承载用户可见后果（源码态 `pnpm dsh --profile daypaw` 不会自初始化）。
- 播种在每次 `daypaw` 调用时运行、不问子命令，`daypaw plugin --profile daypaw …` 与配置转储看到同一个播种出的 profile；代价是每次启动一次 stat 加链接 heal。
- `daypaw plugin` 的 pnpm 操作可能把未登记的 engine 软链从 profile 的 `node_modules` 清掉；下一次启动会重新 heal。engine 刻意不进 profile manifest 的 `dependencies`：pnpm 会试图从 registry 拉取这个未发布的包。
- engine 包名或其 config 键的任何改名必须在同一改动里更新播种模板；REAL-composition 测试钉住该行的 id、name 与 config。
