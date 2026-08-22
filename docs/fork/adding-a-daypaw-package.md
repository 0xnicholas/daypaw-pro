# Cookbook: adding a `@daypaw/*` package

新 `@daypaw/<pkg>` 包的逐文件机械清单。对应上游规范：`docs/cookbook/adding-a-package.md`（dsh 侧）；本清单以 `store` / `engine` / `sdk` 三次落地验证并就地修正（沿用上游 cookbook 立场）。决策依据：ADR 0001（命名/版本/fork 卫生）、ADR 0006（包切分与方向铁律）、ADR 0007（测试门）、ADR 0008（落地顺序）。

模板包：`packages/core/tools`（上游）。

## 0. 前置

- 批次 A 已完成（fork 导入 + 首 checkpoint tag），`pnpm install` 与全量测试绿。
- 该包的 spec 章已存在（ADR 0006「空壳包是自锁」：spec 未到的包不建）；manager/evo 预留位另须子项目立项（ADR 0009）。

## 1. 建包骨架

```
packages/daypaw/<pkg>/
  package.json     # 从 packages/core/tools 拷贝调整
  tsconfig.json    # extends ../../../tsconfig.base.json，rootDir src，
                   # outDir lib/types；references: ../../../vendor/cosmokit、
                   # ../../../vendor/cordis（+ 每个 @daypaw 依赖的 ../../daypaw/<dep>）
  src/index.ts     # 插件（name/inject/apply/Config）或纯库出口
  tests/           # vitest projects 与覆盖率门按 packages/*/* glob 零配置纳入
  README.md        # 见 §4
```

`package.json` 不变集：

- `name: "@daypaw/<pkg>"`、`private: true`、`version: "0.0.0"`（独立 0.x 演进；constraints 的严格不变集 scope 限 `@deepseek-ai/dsh-*`，版本不对齐 root——ADR 0001 §3）。**可发布例外**：`@daypaw/cli` 与 `@daypaw/sdk` 经 ADR 0011 核准发布——真实 `0.x` 版本、`publishConfig.access: public`、repository 指向 fork 仓库；消费方自备的单例（cordis、dsh-invariants、zod）用 npm range 作 peer，其余 workspace 引用保持 `workspace:^` 协议（constraints 与 package-invariants 两门各有一条对应豁免，登记在 CORE_TOUCHES.md）。
- 自愿镜像 dsh manifest 形状：`type: module`、`main: "lib/index.js"`、`types: "lib/types/index.d.ts"`、`exports["."].types` / `.default`、`files` 清单同上游规约（`lib/index.js`、`lib/invariant.js`、`lib/types/**/*.d.ts` 等）。
- `@deepseek-ai/cordis` 同时入 `peerDependencies` 与 `devDependencies`（同 range；插件包必须，纯库包按实际需要）。
- 运行时校验器入 `dependencies`：sdk 用 zod（ADR 0003 / spec 02 双 schema 并存裁决）；其余包按章定。
- 包内相对导入一律显式 `.ts` 后缀（编译器改写规则同上游）。

## 2. 根配置登记（首批为 core touch，登记 `docs/fork/CORE_TOUCHES.md`）

| 文件 | 改动 |
|---|---|
| `tsconfig.base.json` | **新 group 一次性**：paths 加 `@daypaw/*` → `./packages/daypaw/*/src` 候选 |
| `tsconfig.host.json` / `tsconfig.client.json` | 每包加 `{ "path": "./packages/daypaw/<pkg>" }` 引用；engine/store/sdk 归 host 聚合，ui-* 归 client（聚合唯一，不同属两端） |
| `knip.json` | 仅当入口逃出仓库发现机制时 |

零改动（glob/发现机制自动覆盖，已核实）：`pnpm-workspace.yaml`（`packages/*/*`）、vitest projects 与覆盖率 globs、`scripts/publint-all.ts`、`tsdown.config.ts`、`.oxlintrc.json`。`scripts/check-workspace-constraints.ts` 的 release-member 规则已登记 core touch（daypaw 组排除，保 private 姿态）——上游 npm-public 化后此顶不再是零改动。

## 3. 包拓扑与命名

方向铁律（ADR 0006 §1）：`sdk → engine → store`；manager/evo → store；**manager 与 evo 不被任何包依赖**；engine 不依赖 sdk。命名角色词表沿用上游 cookbook §3（Engine/Store/Registry/Runtime/Handle 等的使用与禁用条件），`ctx` key 单复数规则同上游。

## 4. README

沿用上游 canonical 结构：服务 API、事件、扩展点、设计注记 + Model Experience 上下文块 + **Known Limitations and Deferred Work** 节。该门（`scripts/verify-package-readme-limitations.ts`）按 `packages/*/*/package.json` 扫描，**对 `@daypaw/*` 无豁免**；确无限制可述时方可加 whitelist 条目——属上游文件改动，登记 `docs/fork/CORE_TOUCHES.md`。

## 5. 测试与门

- per-file 100% 覆盖率门零配置适用（ADR 0007）；豁免才付 core touch。
- engine：双层崩溃测试（进程内故障注入主力 + 真 SIGKILL 补充）；store：golden 库迁移 fixture；均随包落地，不后补（ADR 0007）。
- 落地后依次跑绿：`pnpm run constraints`、README limitations verify、`pnpm test`、覆盖率门、knip、oxlint。

## 6. core-touch 登记

`docs/fork/CORE_TOUCHES.md` 于批次 C 首触时建档。每条登记：文件、原因、「上游 PR 候选？」标记；每次同步仪式逐个重放验证（ADR 0001 §4）。本清单预期的登记项：`tsconfig.base.json` paths 行、`tsconfig.host.json`/`tsconfig.client.json` references 行、（如用）README whitelist 条目。
