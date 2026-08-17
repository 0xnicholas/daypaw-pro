# ADR 0007: 测试策略（四支柱测试形状 × fork 卫生）

- **状态**：已接受（2026-08-17，[测试策略](https://github.com/0xnicholas/daypaw-pro/issues/12)）
- **前置**：ADR 0001（同步仪式、core-touch 登记制）、ADR 0002（engine 语义）、ADR 0003（SDK facade）、ADR 0004（manager 控制面）、ADR 0006（包结构与 ui-* 家族目录）
- **事实底座**：dsh 测试分层与规则（上游 `docs/testing.md`：五层 tier、真实入口路径、宁真勿 mock、with-key 政策）；上游 `vitest.config.ts` 的 glob 事实——testIncludes 与 coverage include 均为 `packages/*/*`，daypaw 包**零配置自动纳入**，豁免反而要改上游文件（core touch）；`scripts/test-invariants.ts` 的 companion 注册是 `packages/*/*/src/invariant.ts` 纯 glob 约定；上游自身将全部 client UI 与 `host/webserver` 排除出覆盖率门的先例。

## 决策

### 1. 覆盖率门：非 UI 包沿用 per-file 100%，UI 一条 glob 豁免

- **engine / sdk / store / evo / manager host 侧路由包**：沿用上游 per-file 100% 门（CI 的 ci-coverage lane）。glob 已覆盖我们，**沿用零改动；豁免才是要付 core-touch 的选项**。四支柱是故障路径密集代码，未覆盖分支 ≈ 未验证的恢复路径 ≈ bug。
- **client 侧 UI 插件**：统一 `ui-*` 前缀（ADR 0006 已预留家族目录），coverage exclude 加**一条** glob `packages/daypaw/ui-*/src/**`——一次性 core touch，登记 `docs/fork/CORE_TOUCHES.md`，sync 重放几乎不冲突。UI 仍写 jsdom 组件测试 + Loader 冒烟，只是不受门约束。这是抄上游自己的结论（client UI 需浏览器级 harness 才能补满，他们全量豁免了）。
- 否决：全家族豁免（失去死代码探测，engine 风险最大）；逐文件豁免（core-touch 与决策次数累积）。

### 2. 分层沿用 upstream，daypaw 套件并入 `pnpm test`

- unit（`pnpm test`，含 daypaw 套件）/ coverage 门（CI lane）/ with-key e2e（无 key 自跳）/ keyless snapshot（canonical example 拥有）四层照搬；上游 web 浏览器车道 daypaw v1 不建（本地手测 + jsdom，升格条件待观察）。
- **daypaw 重套件留在 `pnpm test`**：同步仪式的诚实性优先——凡 sync 时要绿的测试就是平时要跑的测试。上游 coverage-exempt 重套件机制能免则免（每次使用 = core touch）。
- **invariant companion 为硬约定**：每个跑 cordis 插件测试的 daypaw 包必须带 `src/invariant.ts`（glob 自动接入上游不变量宿主；缺文件直接 throw）。

### 3. 真实入口路径：全套沿用

- **per-plugin REAL-composition 测试**：product-visible daypaw 插件配测试专用 `cordis.yml` 走真 Loader 启动的组合测试；mock 边界仅 LLM / 网络 / 时钟，不许手搓 `ctx.plugin(...)` 了事。
- **canonical example 拥有产品验收**：一个可运行 example（住 `examples/daypaw-*`，纯新增零冲突，即 walking skeleton 宿主——形态归[落地顺序与 walking skeleton](https://github.com/0xnicholas/daypaw-pro/issues/13)票设计），拥有 keyless snapshot + with-key smoke（真模型一发，无 key 自跳）。
- **built-artifact 冒烟**：ship `bin` 的包（如 manager host 的 `daypaw manage`）用构建后 `lib/` 在纯 Node 下跑冒烟。

### 4. 四支柱测试形状

- **engine——双层崩溃/重放**（keyless）：主力 = 进程内故障注入（包装 ledger 写入层，穷举「每个 append 点前后抛异常」；注入时钟跨「重启」推进 durable timer；断言每 effect 恰一次、重放不重不漏）。补充 = 真 SIGKILL（tsx spawn 子进程跑 run、杀掉、重启验 boot 扫描与半写路径）；如需进上游 `processBoundTests` 单列 lane，每条一行 core touch 登记。否决只取一层：仅注入则真死亡路径（半写 WAL、进程锁）永远未验证；仅真 kill 则慢且难穷举，100% 门下分支覆盖不可达。
- **sdk**：行为测试跑**真 engine**（宁真勿 mock；进程内 + 临时目录 SQLite）；五原语各配契约测试；tsc 类型面独立断言套件（[SDK API 表面草图](https://github.com/0xnicholas/daypaw-pro/issues/10)已验证路径）。
- **store**：golden 库 fixture——每个 schema 版本提交一个小型 SQLite 历史库 + record 脚本生成（review 用 `sqlite3 .dump` 看文本 diff）；测试链 = 旧库 → 迁移 → 断言 schema + **旧 run 可重放**。否决生成式旧库（永久维护旧建表代码）；否决只验 schema（恰好漏掉迁移破坏重放语义这个最大风险）。
- **evo**：mock-at-LLM-boundary 全循环——完整 EVO 循环作为真 workflow 跑真 engine，生成 / rubric judge / 被测 agent 全走 dsh 现成 scripted mock model；评估集从提交的 fixture session log 真提取；预算（迭代+成本）、双门、attempt 链、提案打包全真逻辑。keyless 确定性；另配 with-key smoke（真 LLM 对玩具 agent 一轮，自跳）。否决分段单测（EVO 的产品就是循环形状本身）。
- **manager**：host 侧路由包按服务代码走 100% 门（真 SQLite fixture 直读）；ui-* 走 jsdom（见 §1）。

### 5. CI：轻量 + UI 禁用 + 纯新增 workflow

- 继承的重车道（windows/wine、e2b、release、landlock、docs-pages 等）用 **GitHub UI 禁用**——不动文件、零 core touch、可逆。保留 linux 主门：test / coverage / snapshot / typecheck / lint。
- daypaw 特有的门（如未来 walking skeleton 专属冒烟）用**全新 workflow 文件**添加（纯新增，merge 零冲突）。
- with-key 测试只本地（CI 恒 keyless，自跳设计保证绿）。

## 后果

- 刚定下的 100% 门有真实执行点：保留的 ci-coverage lane（本地 `pnpm test:coverage` 同样可跑）。
- spec 02/03/04 的「测试面」章以本 ADR 回填（本票同步完成）。
- canonical example 的具体形态移交 walking skeleton 票。
- CORE_TOUCHES 首批预期条目：coverage exclude 的 ui-* glob（§1）、`processBoundTests` 补行如需（§4）、tsconfig/vitest 加性配置行（ADR 0006 已预告）。
