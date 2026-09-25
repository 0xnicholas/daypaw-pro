# Agent Note：2026-09-24 上游 sync 重放

Status: implemented

[English](2026-09-24-upstream-sync-replay.md) | 中文

## Problem

fork 落后上游 3,165 个提交（上次同步基点 2026-09-10，上游已到 `dsh 0.1.7-rc.1`）。这波漂移直接压在本图登记的自有缝上：浏览器 fixture 被删、由 `@deepseek-ai/dsh-remote-mock` 与 client-test-runtime 的 assembly tier 接替；`SESSION_FORMAT_VERSION` 升到 V4、消息来源改为「生产者自有 kind」（万能 `plugin` 类被移除）；`healProfilesModuleFallback` 与整套链接修复式 profile 架构被 runtime resolution generation 取代；上游脚手架换出 assembled-remote / `{exclude, remote}` / `{rpc}` 载体的新本体；浏览器 roster 新增十条上游行（含 `job-controller`——缺它 `ui-jobs` 无法激活）；`agent-presets` 拆成 `agent-preset` + `agent-preset-registry`；PTC runtime 包族改名；两套新门（禁止新 unknown 断言、维护型引用政策）；以及一轮已把成员 manifest 改过的 dependabot 安全组更新。

## Decision

现在合并（距上次同步 11 天），按登记表的重放语义解 44 处冲突，然后逐类裁决：上游重构已取代 fork 缝的地方随上游，fork 票经验证的产品行为保留——全部记入 CORE_TOUCHES：

- **消解、删除**：fixture 种子两行与 `createFixtureConnectionRpc` 再导出（世界已住 `daypaw-remote.ts`）；bubblewrap 安全修订版钉（上游自行改钉 0.12.0 的 archive URL）；两条 `apps/web` e2e 登记行（上游原样文件下两车道全绿，ADR 0018 §4）。
- **保留、重穿**：`@daypaw/assembled-boot` 吸收上游新本体（声明式 manifest patch、`{exclude, remote}` 挂载选项、`{rpc}` 原生载体、teardown `assertNoUnmatched`），三轴重读为「bundle 层 / remote 场景 / 标题」；#105 的行 config 通道再迁到 `client-modules/src/client/entries.ts`（`create(loader, id, config)`）；亮色主题默认重钉到上游重写后的 host/config 文件；#94 的对账重拉保留，其上游断言随动改写。
- **新增 fork 自有缝**：`seedDaypawProfile` 把私有 `@daypaw/web-app` 链进 profile 自己的 `node_modules`，让 launcher 的 runtime resolution 收全家族（被删 heal 的继任物）；`inbox.clear()` 在投影注册已退休时早退，避免 teardown 期 `cancel()` 从 abort 监听器抛出；`install-lefthook.mjs` 按需解析 lefthook，生产安装的 postinstall 不再必败；`verify-repository-references` 豁免 fork 记录树，Agent Note 允许引用落地提交。
- **测试面随动**：skeleton 语料 V3→V4 滚动（文件名代数随头部版本，corpus 契约）；场景镜像 host 的 turn 窗口 `paginate`；roster 期望随上游产品决策（ralph 默认关、`workflow-ptc` 接替 worker-thread 行）；根 pnpm 钉到安全修复版 11.11.0，保住载体/载荷不变量。

## Alternatives considered

**等计划中的 2026-09-27 窗口。** 多等三天、多约 700 提交的漂移，且无里程碑收益；票内剩余三项只被这次合并阻塞。

**干跑支线先验证。** 合并成本相同，且结论到真窗口前就会过期。

**把旧 fixture 缓存进 fork 包以避开迁移。** ADR 0018（路径 A）已明确否决。

## Consequences

- main 在 fork 的必需聚合门上全绿（`check:ci:daypaw-hosted`：76 道，含 build、publint、built-bin smoke 与十条组装金样），`CI=true pnpm run release:daypaw` 端到端通过（CLI tarball 启动、浏览器首渲染、种子 profile 带引擎 ledger、SDK 消费者类型化运行）。
- 全量套件的残红都是宿主环境性的、且落在与上游逐字相同的文件里（npm 11.13 的隔离配置输出、git partial-clone promisor 探针、本机并发下超 5s 预算的子进程测试）；隔离单跑即绿，归 CI 的平台矩阵。
- release 冒烟的 `pnpm deploy --prod` 会把工作区依赖裁成生产态（既有 hazard）：失败一轮后树里没有 `typescript`，重试前先 `CI=true pnpm install`。
- 上游这些改变 daypaw 产品面的决策（ralph 默认关、设置面拆成逐页行、`job-controller` 成为 `ui-jobs` 的硬依赖）按原样继承；壳自己的裁决属 owner 的后续票。
