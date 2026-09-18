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

**宿主包与客户端包分岔**（本清单头三次落地均为宿主包，客户端面按 #116 `durable-client` 与 #118 `client-load` 补记）：

- 客户端包的 `tsconfig.json` extends `../../../tsconfig.base.client.json`，只在 `tsconfig.client.json` 聚合里登记（不同属两端）。
- 客户端包**必须带包级 `tsdown.config.ts`**：`clientBundle('@daypaw/<pkg>', ['lib/types/index.js'])`（浏览器插件，另出 `lib/client.js`）或 `clientLibrary('@daypaw/<pkg>', ['lib/types/index.js'])`（纯库，无插件面）。缺了它，根 workspace 布局会把它当宿主包构建，而该包不在宿主 tsconfig 里、`lib/types` 为空 → `build:lib:host` 报 `Cannot find entry: ["lib/types/{index,invariant,startup,agents-dir}.js"]`（#118 的 CI 首跑教训）。
- `staticLinked` 不是「能构建」的开关：它是静态组装花名册（壳静态链接该包并拥有 chunk 划分）。被 ui-* 浏览器 bundle 内联的普通依赖用 `clientLibrary`，不要用 `staticLinked`。
- README 的 `ts` 示例若 import 客户端包，必须在 `doc-typecheck:contracts-ready` 下可编译（standalone 模式只 references 宿主包，客户端源文件不在临时工程 file list 内）——否则写 ` ```ts ignore-check `（先例 `docs/api-gateway.md`），或改写为不引客户端包的片段。

`package.json` 不变集：

- `name: "@daypaw/<pkg>"`、`private: true`、`version: "0.0.0"`（独立 0.x 演进；constraints 的严格不变集 scope 限 `@deepseek-ai/dsh-*`，版本不对齐 root——ADR 0001 §3）。**可发布例外**：`@daypaw/cli` 与 `@daypaw/sdk` 经 ADR 0011 核准发布——真实 `0.x` 版本、`publishConfig.access: public`、repository 指向 fork 仓库；消费方自备的包（cordis、zod、dsh-attachment——attachment 承载闭包内 dsh-llm 声明的类型引用，#110；dsh-invariants peer 已随空壳 companion 退役，ticket #87）用 npm range 作 peer，其余 workspace 引用保持 `workspace:^` 协议（constraints 门有一条对应豁免，登记在 CORE_TOUCHES.md）。
- 自愿镜像 dsh manifest 形状：`type: module`、`main: "lib/index.js"`、`types: "lib/types/index.d.ts"`、`exports["."].types` / `.default`、`files` 清单同上游规约（`lib/index.js`、`lib/types/**/*.d.ts` 等）。**invariant companion 默认缺席**（上游 `15f2997bcb` 口径，ticket #87）：不建 `src/invariant.ts`、不发布 `./invariant` 导出与 `lib/invariant.js`，README（en+zh）末尾写逐包理由句 `**Runtime invariant:** No companion is published. …`；只有拥有「可独立分歧观测」关系的包才建真 companion。
- `@deepseek-ai/cordis` 同时入 `peerDependencies` 与 `devDependencies`（同 range；插件包必须，纯库包按实际需要）。
- 运行时校验器入 `dependencies`：sdk 用 zod（ADR 0003 / spec 02 双 schema 并存裁决）；其余包按章定。
- 包内相对导入一律显式 `.ts` 后缀（编译器改写规则同上游）。

## 2. 根配置登记（首批为 core touch，登记 `docs/fork/CORE_TOUCHES.md`）

| 文件 | 改动 |
|---|---|
| `tsconfig.base.json` | **新 group 一次性**：paths 加 `@daypaw/*` → `./packages/daypaw/*/src` 候选 |
| `tsconfig.host.json` / `tsconfig.client.json` | 每包加 `{ "path": "./packages/daypaw/<pkg>" }` 引用；engine/store/sdk 归 host 聚合，ui-* 与客户端纯库归 client（聚合唯一，不同属两端） |
| `docs/config-catalog.md`(+`.zh.md`) | 新包会进「库包（无插件入口）」清单——`pnpm run gen-config-catalog` 再生**英文侧**，中文侧按配对流程随动并重录 sidecar（生成器只写英文） |

零改动（glob/发现机制自动覆盖，已核实）：`pnpm-workspace.yaml`（`packages/*/*`）、vitest projects 与覆盖率 globs、`scripts/publint-all.ts`、根 `tsdown.config.ts`（客户端包仍需自己的包级配置，见 §1）、`.oxlintrc.json`。`scripts/check-workspace-constraints.ts` 的 release-member 规则已登记 core touch（daypaw 组排除，保 private 姿态）——上游 npm-public 化后此顶不再是零改动。

## 3. 包拓扑与命名

方向铁律（ADR 0006 §1）：`sdk → engine → store`；manager/evo → store；**manager 与 evo 不被任何包依赖**；engine 不依赖 sdk。命名角色词表沿用上游 cookbook §3（Engine/Store/Registry/Runtime/Handle 等的使用与禁用条件），`ctx` key 单复数规则同上游。

## 4. README

沿用上游 canonical 结构：服务 API、事件、扩展点、设计注记 + Model Experience 上下文块 + **Known Limitations and Deferred Work** 节。该门（`scripts/verify-package-readme-limitations.ts`）按 `packages/*/*/package.json` 扫描，**对 `@daypaw/*` 无豁免**；确无限制可述时方可加 whitelist 条目——属上游文件改动，登记 `docs/fork/CORE_TOUCHES.md`。

## 5. 测试与门

- per-file 100% 覆盖率门零配置适用（ADR 0007）；豁免才付 core touch。
- engine：双层崩溃测试（进程内故障注入主力 + 真 SIGKILL 补充）；store：golden 库迁移 fixture；均随包落地，不后补（ADR 0007）。
- 落地后依次跑绿（#118 实测清单；`knip` 已随上游演进退场，本仓不再存在）：`pnpm run constraints`、`pnpm run verify-package-dependencies`、`pnpm run verify-runtime-closure`、`pnpm run verify-tsconfig-paths`、`pnpm run lint`、README 三件门（`verify-package-readme-limitations` / `-model-experience` / `-summaries`）、本包 `vitest` + per-file 覆盖率门、`pnpm run gen-config-catalog --check`、`pnpm run doc-typecheck`、`pnpm run verify-translation-pairing`。
- 新包要在**净树**上验证，别靠本地热 `lib/`：`rm -rf packages/daypaw/<pkg>/lib && pnpm run build:lib:host`（宿主面必须跳过客户端包），再 `pnpm run build`（客户端面出 `lib/index.js`，消费方 bundle 把它内联）。
- 客户端包若进了浏览器 roster：`pnpm run test:web:daypaw:built`（组装金样车道，需先 `pnpm run build`）。

## 6. core-touch 登记

`docs/fork/CORE_TOUCHES.md` 于批次 C 首触时建档。每条登记：文件、原因、「上游 PR 候选？」标记；每次同步仪式逐个重放验证（ADR 0001 §4）。本清单预期的登记项：`tsconfig.base.json` paths 行、`tsconfig.host.json`/`tsconfig.client.json` references 行、（如用）README whitelist 条目。
