# Agent Note：daypaw 直起壳交付——argv 默认、bundle 迁移、闭包 heal、dist 随 tarball

Status: implemented

[English](2026-08-26-daypaw-direct-shell-delivery.md) | 中文

## 问题

issue #62 把 `daypaw` 命令变成产品壳的正门（spec 05 §4）：裸 `daypaw` 须从安装的 tarball 直接启动浏览器壳，安装期零构建。#54 脚手架与该验收之间有四个缺口：vendored launcher 语法强制 `--profile <name>`，裸 `daypaw` 直接报错；播种的 profile 还是单发 headless 元组而非壳 bundle；launcher 的安装 fallback 只 heal dsh app 闭包，壳树点名的每个 `@daypaw` 行（`@daypaw/engine`、`@daypaw/web-app` 胶水及其 `/startup`、以及 `modules` 经 `createRequire(ctx.baseUrl)` 从 profile 目录解析的 roster 包）在真实安装里没有解析路径；前端 dist 是构建期产物，但 release 管线既不构建也不打包它。

## 决策

- **fork 自有的 argv 适配器，而非上游 launcher 缝。** `@daypaw/cli` 的 `withDefaultProfile(argv)` 把裸调用（及裸 `plugin` 子命令）映射为 `--profile daypaw` 前置于应用参数；显式带 `--profile`、或用 vendored `web` 别名（上游 web profile、自有语法）的调用原样透传，dsh launcher 完整语法仍可达。`bin.mjs` 在导入 dsh bin 前改写 `process.argv`。在 `apps/cli/src/args.ts` 加默认 profile 的 env 缝会为纯 fork UX 新增一处上游 core touch；适配器不复刻任何语法（只看三个 token：`--profile` 旗标、`web`、`plugin`），其映射由 spec 钉死。
- **播种元组换成壳组合，附精确匹配迁移。** `DAYPAW_PROFILE_BUNDLES` 改为 `['@deepseek-ai/dsh-base', '@daypaw/web-app']`；bundles 仍与上一版出厂 headless 元组完全一致的 profile 迁移到新元组并保留其余 manifest 字段——镜像 launcher 自身 `normalizeShippedProfile` 先例但归 fork CLI 所有；任何偏差都是用户所有、原样不动。
- **一个 heal 机制：CLI 以自身 manifest 为锚调用 launcher 的 fallback heal。** 播种调用已导出的 `healProfilesModuleFallback`，以本包 manifest 为安装锚，把交付闭包——engine、壳 bundle、roster 包、前端——平铺链接到 `$DSH_HOME/profiles/node_modules`。旧机制（profile-local 的 `@daypaw/engine` 链接）退役：fallback 在每个 profile 的 pnpm 管辖区之外，`daypaw plugin` 操作再也剪不掉链接，且行的解析只剩一条路径。旧安装遗留的 profile-local 链接成为悬空条目，Node 的 parent-walk 跳过它（升级 spec 用例覆盖）。这间接消费了[共享 note](../architecture/2026-08-26-ensure-symlink-shared-from-app-boot.md) 的 `ensureSymlink` 缝——heal 本身上游早已导出。
- **dist 以构建期产物随包。** release 管线新增第三个构建面（`@daypaw/web-frontend` vite 构建），先于把它拷进闭包的 deploy；`bundleDependencies` 钉死；安装期零构建（spec 05 §4 打包裁决、ADR 0011 单 artifact 版本线）。
- **冒烟证明正门。** `smokeCli` 在干净 prefix、全新 `DSH_HOME` 下裸启 `daypaw --port 0`，等 `daypaw web:` URL 行，趁服务存活抓取被服务的 dist 页面，随后终止并断言播种工件（engine 行、fallback 链接、dist、ledger）。旧冒烟的缺凭据形状属于 headless 面；壳不需要 key 即可服务。

## 否决的备选

- **上游 launcher 的默认 profile env 缝** — 否决：为 fork 专属 UX 新增上游运行时文件改动，徒增交付闭包的登记例外，而适配器已能覆盖。
- **保留 profile-local engine 链接并另加 fallback 链** — 否决：一份工作两个 heal 机制，profile-local 那条仍会被 profile 内的 pnpm 操作剪掉。
- **硬编码逐包链接清单（engine、web-app、roster）** — 否决：闭包 BFS 已以导出的 `healProfilesModuleFallback` 存在；以 CLI manifest 为锚即零新增遍历代码复用它，未来新增 `@daypaw` 行无需维护清单。
- **用 fork CLI 解析器包一层 launcher 再重放 dsh 语法** — 否决：复刻 launcher 语法并随之漂移；三个 token 的检视就是全部 fork 面。

## 后果

- 裸 `daypaw -h`/`--help` 现在打印壳应用的 help（注入的 profile 把旗标交给应用），与 `dsh --profile web -h` 语义一致；launcher 自身 help 不再是裸命令的面。
- 单发 headless 离开 CLI（spec 05 §4）：程序化 durable 工作走 `@daypaw/sdk`，单发 CLI 运行显式 `--profile` 上游 profile。CLI README 的限制节记录此事。
- tarball 增大 web-app 闭包与构建出的 dist；闭包完备性仍归 release 管线的 restore 轮次所有，冒烟的 dist 探活在未来的打包改动丢掉 dist 或任一 roster client bundle 时大声失败（modules 激活不变量拒绝广播无法解析 client bundle 的行）。
- vendored `web` 别名在 `daypaw web` 上仍可达并启动上游 web profile——专家逃生门而非产品面；README 记录。
- 出厂模板的元组变更从此只在已发布元组需要迁移时更新 `PREVIOUS_DAYPAW_PROFILE_BUNDLES` 机制；spec 同时钉住新播种与迁移两条路径。
