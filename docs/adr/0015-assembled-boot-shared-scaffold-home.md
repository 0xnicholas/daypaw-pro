# ADR 0015: assembled-boot 脚手架的家——fork 局部参数化包

- **状态**：已接受（2026-09-19，[assembled-boot 脚手架 fork/上游近克隆提取到 test-support——先裁时机与上游形态](https://github.com/0xnicholas/daypaw-pro/issues/123)）
- **前置**：ADR 0001（同步策略与 fork 卫生——§4 core 触碰三问）；ADR 0007（测试策略）；ADR 0014（同一「fork 局部包 + 退役触发」裁决形态）；[durable/* fixture 迁装饰器 transport](https://github.com/0xnicholas/daypaw-pro/issues/90)（`__DSH_TRANSPORT__` 载体钩子先例）；[trajectory 检查器 config 通道](https://github.com/0xnicholas/daypaw-pro/issues/105)（`dsh.client.config` 声明制）
- **事实底座**：`apps/daypaw-web/tests/assembled-boot.ts`（360 行）与 `apps/web/tests/assembled-boot.ts`（305 行）为近克隆，真实差异轴为 bundle 顶层层路径、transport 装配（`?fixture` 自选 vs `__DSH_TRANSPORT__` 载体钩子）、`document.title`、声明制 config 转发与 inject/immediately 展开形态；locale 钉制两车道实际相同（皆 `en-US`，fork 份旧头注自称钉中文与代码不符）。上游 2026-05~08 触碰该文件约 15 次；fork 副本诞生两周内已付一次手工重放（#90）、长出一次漂移（#105）。上游 `CONTRIBUTING.md` 明写不接受外部 pull request（ADR 0014 事实底座）。

## 决策

### 1. 现在提取，不等上游重构顺车

漂移已两次咬人，fork 侧壳工程持续演化该脚手架消费面；上游重构何时来不可知，且真来了之后「换体」（把上游新本体替换进共享 module、重穿参数缝）与「顺车提取」成本几乎相同——参数缝就是稳定接口。等待只累积赌注期内的漂移风险。

### 2. 家 = fork 自有新包 `@daypaw/assembled-boot`

`packages/daypaw/` 家族规则零例外、release families 零改动；daypaw 概念（`decorateDurableRpc`）留在 `apps/daypaw-web/tests` 经 carrier 参数注入，共享体内零 daypaw 词汇。否决 `packages/test-support/` 组内新子包（fork 包进上游组目录撞 family-dir 规则，`families.ts` 跳过清单要加目录、本身又是一次 core touch）与塞进既有上游 test-support 子包（= 上游包源码 core touch，fork 需求种进上游包）。

### 3. 参数面三轴 + 声明制 config

lane 选项 = bundle 层（base 可覆写 + web 层）、remote 场景工厂（逐挂载铸造世界并以其 `rpc` 为页面载体；`{ rpc }` 是上游原生载体通道，2026-09-24 sync 换体后手写信封桥退役）、钉制标题。config 转发是共享能力而非参数：行携带 config 且包声明 `dsh.client.config` 才进图（#105 声明制），上游车道零行为变化。locale 钉制（`en-US`）两车道相同，住进共享 module。

### 4. 上游形态 = 保形 + 退役触发

上游无接受通道，「提上游」是空管道。两处 core touch（上游 `apps/web/tests/assembled-boot.ts` 变薄 stub、`apps/web/package.json` 加 devDep 行）标「可提」；退役触发：上游若自建同等参数化，下次 sync 评估换家（README Known Limitations 记录）。

## 考虑过的替代方案

**等下次上游重构顺车**：赌上游先重写再需要重放；赌输 = 再付一次重放，漂移继续长。**维持现状**：漂移靠 CORE_TOUCHES 记账 + sync 人工比对，风险敞口不变。**fork 局部半提取**（只把组合逻辑进包、env/mount 胶水留在各 stub）：恰好在 upstream 最常动的胶水部分保留两份，重造本问题。**塞进 `@daypaw/durable-client` / `ui-*`**：测试脚手架稀释 wire 词汇家 / GUI 家族语义。

## 后果

- 上游 lane 的 stub import 一个 fork 包；CI 两车道照跑，机械无碍。drift（config 通道）收敛为一份；注入/展开形态统一为上游现行条件展开（两车道金样实证零行为变化）。
- sync 重放语义变化：上游重构该脚手架 = stub 冲突 → 取上游新本体替换共享 module 本体、重穿三缝；选项不变即零重放。2026-09-24 sync 实证一次换体：上游新本体（声明式 patch、`{exclude, remote}` 挂载选项、`{ rpc }` 原生载体、teardown unmatched 断言）入驻共享包，三缝重读为「bundle 层 / remote 场景 / 标题」。
- 新包入 per-file 100% 覆盖率门（非 `ui-` 前缀）；组合半边导出为可测单元，微花名册 fixture 承载分支矩阵，不靠整图启动。
- core touch 登记：`apps/web/tests/assembled-boot.ts`（可提）、`apps/web/package.json`（加性 devDep）；`tsconfig.client.json` 与两 app 工程引用追入既有登记行。
