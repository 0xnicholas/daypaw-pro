# Agent Note：ensureSymlink 自 dsh-app-boot 共享——交付闭包唯一登记在册的运行时 core touch

Status: implemented

[English](2026-08-26-ensure-symlink-shared-from-app-boot.md) | 中文

## 问题

`pnpm run duplication` 在干净 checkout 上每轮必红（issue #64）：`@daypaw/cli` 的 `ensureEngineLink` 内联复制了 `dsh-app-boot` 私有 `ensureSymlink` 的幂等 symlink 治愈逻辑（42 行 / 72 tokens 的 clone）。副本已经按副本的方式漂移——错误前缀（`daypaw:` vs `dsh:`）、少一条 Windows unlink 注释、EEXIST 竞态分支缺 `v8 ignore`——放任不管只会看着 clone 变大。去重需要治愈逻辑只有一个家，而每个候选家都要动上游文件：`packages/boot/app-boot/src/profile.ts` 属上游所有，且[模板播种 note](2026-08-22-daypaw-profile-template-seeding.md) 之前刻意让交付线远离上游运行时改动，以保住 ADR 0011 §1 对发布闭包的零 core touch 前提。

## 决策

- **`dsh-app-boot` 导出该治愈逻辑；错误文案参数化。** `ensureSymlink(binName, link, target, manages)` 自 `packages/boot/app-boot/src/profile.ts` 公开；两处文案差异成为参数，两个调用点的错误逐字节不变（`dsh`/`the installation fallback`、`daypaw`/`the profile's engine link`），由 `profile.spec.ts` 与 `seed-profile.spec.ts` 的精确字符串断言钉住。
- **`@daypaw/cli` 删除内联副本**：`ensureEngineLink` 只算 `link`/`target` 后委托。其 spec 仍以 `node:fs` mock 演 EEXIST 竞态；mock 按模块拦截而非按导入方，故对搬移后的代码同样生效。
- **profile.ts 的改动登记而非走私**：`docs/fork/CORE_TOUCHES.md` 记一行，标为上游 PR 候选（导出 + 诊断参数化在上游自洽）。ADR 0011 §1 的前提获得一个登记在册的例外而非被放弃：发布管线本就打包 fork 工作区闭包（`pnpm deploy` + `bundleDependencies`），打包出的 `@daypaw/cli` 携带 fork 的 `dsh-app-boot` 而管线零改动；上游接受后随下一次 sync 划掉该行。EEXIST 分支保留 `v8 ignore`：导出函数并不使 lstat 到 symlinkSync 之间的窗口可从公开 API 确定性地演出来。

## 否决的备选

- **给这对文件加 jscpd ignore** — 否决：那等于给 clone 盖永久印章而副本继续漂移；该门存在的意义正是逼出这次合并。
- **新建 fork 自有的 util 包供两边引用（issue #64 方案 B）** — 否决：`app-boot` 消费它仍要改上游文件，core touch 记账相同；为一个函数增一个包只扩大 workspace 而无额外去重收益。
- **在 `dsh-app-boot` 内加 fork 自有新文件** — 否决：仍是 core touch，且比原地导出既有私有函数更难作为上游 PR 候选。

## 后果

- 上游同步仪式（ADR 0001）每次 sync 重放该改动；丢失会大声失败——`@daypaw/cli` 对没有该导出的 `dsh-app-boot` 无法通过类型检查——漂移在构建期暴露，绝不静默。
- 发布的 CLI tarball 以上游名义打包 fork 改过的 `@deepseek-ai/dsh-app-boot`；`bundleDependencies` 使其只存在于 tarball 内部，不会与消费者另行安装的上游 npm 副本冲突。模板播种 note 的零 core touch 表述改为指向本 note 记录的例外。
- 治愈逻辑的后续消费方各自传 `binName` 与 `manages`；消息契约在既有两侧被逐字节钉住，改文案会当场红两个测试。
