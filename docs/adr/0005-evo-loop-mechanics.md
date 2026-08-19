# ADR 0005: EVO 循环机制

- **状态**：已接受（2026-08-30，[EVO 循环机制](https://github.com/0xnicholas/daypaw-pro/issues/9)）；2026-08 起降级为远期子项目方向文档（ADR 0009）
- **参照**：AIP Evolve 机制调研（`docs/research/aip-evolve.md`，main 分支；要点：发布/版本化机制无公开文档，有据可查契约 = 人配置 run → 多迭代自动生成/测试 → evals + 专家双门过滤 → 带 lineage graph 与 diff 的 final proposal）+ Palantir Agent Stack 参照系（`docs/research/palantir-agent-stack.md`）+ 观测地形（Run Registry 为发布后监控面）
- **前置**：ADR 0002（ledger 记定义版本）、ADR 0003（定义注册表、`run()` 一等公民、代码优先编程模型）、ADR 0004 §6（EVO 数据契约：自拥输出表，直读 ledger + 关联层 + session log）
- **编号注记**：票面写「产出 ADR 0004」，但 0004 已被 Manager 票消费；本决策为 ADR 0005。

## 决策

### 1. 优化粒度：定义级变体 + 类型化算子

**变体 = agent 定义的新版本**（整条组合行），变异算子类型化，v1 开放三维度：**模型路由、prompt 段、工具面子集**。变体经定义注册表注册（name + 新 version），与 incumbent 同名不同版本并行 run——ADR 0003 §3 的既有地基，无新机制。

第四维（架构级「消除不必要 LLM 调用」）v1 不做：Palantir 靠 Ontology 作结构化数据源，daypaw 无等价物（候选=ledger + tool schema，未成形），记入 map 雾区。

否决：自由重写定义（diff 无法类型化、评估难做、爆炸半径大；Palantir 自己也只是把架构改动当 allowlist 类目，非自由重写）；运行时路由层变体（绑引擎热路径，评估归因与发布回滚复杂化）。

**Palantir 事实记录**：有据可查的粒度是一个已部署 AIP Logic function 整体（模型换血作用于整个 function）；per-step / per-call-site 路由未记载。我们对齐 function 级。

### 2. 评估集：真实提取为主 + 人策种子 + 合成扩量

- **主源 = ledger / session log 里的真实运行**（带人反馈的 run 优先）——自用场景的独家资产。
- **人工策展定种子集**（关联层 dataset 概念的实例）。
- **LLM 合成仅做扩量，标记来源**——不单独构成晋升证据（决策 5 漂移防线的一环）。
- 回放 = 同输入重跑变体 vs incumbent，judge 判定见决策 4。

否决：纯人工策展（自用维护成本高，浪费全量真实 run）；纯合成生成（无真实分布接地，回归判据自证循环）。

**Palantir 事实记录**：其评估集来源未记载；demo 可见 Evolve 按类目划分场景并抽样送专家审。姊妹产品 AIP Evals 支持手工建例 + 一键生成 + rubric judge——我们取「混合来源」为设计自由。

### 3. 候选生成：规则枚举 + LLM 重写，两段式

**离散维度（模型路由、工具面子集）用规则枚举**——组合空间小、无需创造力、可重现；**语言维度（prompt 段重写）用 EVO 自己的 LLM agent**。两类生成器产出同一类型化变体，走同一评估管线。两段式形状与 Palantir demo 对齐（先跨 provider 筛模型套件、剪枝，幸存者逐个重调 prompt）。

**Palantir 事实记录**：优化器内部架构（规则 vs LLM proposer）无记载；两段式是对 demo 形状的诚实重建，非接口抄袭。

### 4. 晋升判据：双门 + 分层 judge

- **质量门**：逐维度 ≥ incumbent − ε；关键维度严格不差，容差按维度可配。
- **效率门**：成本 / 延迟至少不减益。
- **判定器三层**：zod 校验（免费的质量下界）→ rubric judge（LLM，按维度配严格度 exact / 语义等价 / best-effort——Palantir「validation strategy」的类型化版）→ 人工抽检（终审归决策 5 的人审）。

否决：加权总分制（维度间拆东墙补西墙被总分掩盖）；零容差全面不差（LLM 输出噪声下几乎无可胜者，循环僵死）。

### 5. 发布：代码提案，人审内建

胜出变体打包为**提案**：类型化 diff（组合行三维度）+ 实验记录（lineage：父版本、算子 diff、数据集版本、judge 判定、eval 证据）+ 证据链接。人审后**应用为代码中的定义新版本**（EVO 可代开 PR）。**代码是唯一正典；git 即版本史；回滚 = revert。** EVO 永不自动生效——「自主」止步于提案（与 Palantir「autonomous」的真实口径一致：run 内自动化，非无人值守发布；其发布机制本身无文档，全为设计自由）。

否决：活跃版本指针（运行时覆盖层，生产行为与仓库代码漂移，代码优先模型被削弱）；preset 发布（与 ADR 0003 双路并存决策缠斗，代码/文件两套正典）。

**评估集漂移四层防线**：① 版本化——评估集是版本化 artifact，阈值与数据集版本绑定；② 定期补充——新真实运行经人工策展入集；③ 合成隔离——标记来源，不单独构成晋升证据；④ 发布后监控——Run Registry 看生产指标，异常即 revert。

### 6. 触发与预算：按需 + 双上限

优化 run 由人发起，配置面：目标定义、算子 allowlist、验证策略、数据集版本、**迭代预算 + 成本上限**——任一触顶自动停。无定时 / 常驻循环。与 Palantir 有据可查的契约一致（配置向导 + 预算 + 「Evolve」按钮）。

### 7. 形态：EVO 本体 = 引擎上的 workflow

优化循环本身是一个 `defineWorkflow`：生成 / 评估 / 剪枝 / 提案各为 `ctx.step`，人审 = `ctx.waitFor` gate（零算力等待），崩溃续跑免费，优化过程在 Manager 可视。吃自己的狗粮 = 对引擎最好的验收测试。无自举悖论：支柱④最后落地，引擎先在场；EVO 优化**用户的 Agent**、不优化自己（map Notes 锁定），无自指。

## 后果

- spec 第 4 章骨架输入：`docs/spec/04-evo.md`。
- 变体 / 实验 / 提案表的具体 schema（EVO 输出表，ADR 0004 §6 所有权）= spec 撰写期设计题，与第 3 章 §4 契约对齐。
- 评估集提取管线、judge 题板、抽检采样率、ε 与容差默认值 = spec 细节，非 ADR 级。
- 架构级第四维（消除不必要 LLM 调用）回 map 雾区，待结构化数据源讨论重启。
