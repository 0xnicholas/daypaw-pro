# ADR 0008: 落地顺序与 walking skeleton

- **状态**：已接受（2026-08-17，[落地顺序与 walking skeleton](https://github.com/0xnicholas/daypaw-pro/issues/13)）；§4 的 map #1 雾区语句已由 ADR 0009 作废
- **前置**：ADR 0001（同步仪式、新 family、`@daypaw/*` 独立 0.x、core-touch 登记）、ADR 0002（引擎语义）、ADR 0003（编程模型、注册表）、ADR 0006（三包切分与预留位、撰写期设计题登记）、ADR 0007（测试策略：per-file 100% 门、双层崩溃测试、store golden fixture）
- **事实底座**：本仓库当前为纯设计文档（无码，fork 未导入）；dsh 加包规范（docs/cookbook/adding-a-package.md）；dsh constraints 脚本按 scope 分支——严格 manifest 不变集（版本对齐 root、cordis peer/dev 镜像、main/types/exports）仅作用于 `@deepseek-ai/dsh-*`，非 dsh scope 包仅被强制 `private: true`；README Known Limitations 门与 vitest projects/覆盖率 globs 均按 `packages/*/*` 零配置覆盖 `packages/daypaw/`。

## 决策

### 1. Walking skeleton = 三包最薄端到端耐久竖切

- **@daypaw/store**：engine-ledger schema（runs + journal 两表）+ 迁移骨架。无 commands 表、无关联层（Manager/EVO 地界，互不穿透）。
- **@daypaw/engine**：`ctx.durable` 插件、journal effect+result append、step 去重续跑、run 生命周期、boot 扫描、每 run 单写者、定义注册表（不透明 body thunk，ADR 0006 §2）。
- **@daypaw/sdk**：仅 `defineWorkflow` + `def.run(input, { runId? })` 幂等 start-or-attach + RunHandle（类型化结果归因）。
- **证明线**：canonical example workflow（平凡 3-step body）真 SIGKILL 中段杀死，boot 后续跑至类型化完成；进程内故障注入层同批落地（ADR 0007 双层崩溃测试一次到位）；store golden fixture 迁移测试随迁建。
- **明确在外**：defineAgent（需 dsh session 挂载面，把 llm/preset 机械拖进 skeleton，淹没耐久命题）、sleep/timer、waitFor/HITL、spawn 子 run、retry 面、Manager/EVO 一切、profile/bundle 接线、bin 冒烟、wire 扩展。

否决：engine+sdk 对内存 stub store（不证 SQLite 崩溃一致性——恰是真正的风险缝，耐久主张空心化，store 落地前结论都不算数）；bottom-up store 先行各自做全（端到端行为最后才可见，集成意外最晚暴露，「会走的骨架」到最后才会走）。

### 2. 交付批次：Import → spec 01 → skeleton → spec 00

- **批次 A — fork 导入 + 首 checkpoint**：加 upstream remote → merge 上游历史 → install → 全量测试绿 → `daypaw-sync/<date>` tag（注释携上游 sha）。兼充支柱①里程碑开工前的强制同步仪式（ADR 0001）。此后 spec 引用真码而非参考检出。
- **批次 B — spec 第 1 章 Durable Execution**：skeleton 所实现的章，先写。撰写期设计题＝store 迁移机制选型（手写 SQL vs drizzle 类，ADR 0006 后果登记项），在本批次内裁决。
- **批次 C — skeleton 落地**：store → engine → sdk，按 `docs/fork/adding-a-daypaw-package.md` 清单执行；首批 core touch（`tsconfig.base.json` paths 新 group 行、`tsconfig.host.json` references 行）同批登记 `docs/fork/CORE_TOUCHES.md`（随首触建档）。
- **批次 D — spec 00-overview 最后写**：frame + 包图（对已落地的真实包形）+ daypaw profile/bundle 行清单设计（ADR 0006 §5 登记的撰写期设计题）——此时设计输入最全，一次写准。

否决：spec 00 先行（其真实依赖——落地包形、具体 bundle 行——尚不存在，写完必返工）；skeleton 先行于 spec 01（设计问题将在 code review 而非 spec 中裁决，违背「实现者不再回来问设计问题」的到达判据）。

### 3. 首包机械清单 = `docs/fork/adding-a-daypaw-package.md` 活文档

- 清单内容见该文档；立场沿用 dsh cookbook 自身规约——以 store/engine/sdk 三次落地验证之，漂移处就地修文档；后续 manager/evo/ui-* 落地复用。
- 关键 gate 事实（决定清单形状，非额外决策）：
  - **版本独立 0.x 不撞 constraints**：严格不变集 scope 限 `@deepseek-ai/dsh-*`；`@daypaw/*` 仅被强制 `private: true`。ADR 0001 §3 无需修订。
  - 其余 manifest 不变集（type:module / main / types / exports / files 清单 / cordis peer+dev 镜像）**自愿镜像**，保 tsdown/publint/声明形状与全仓库一致。
  - README **Known Limitations and Deferred Work** 节必选（该门按 `packages/*/*` 扫描，无 scope 豁免）；whitelist 条目属上游文件改动，须登记 core touch。
  - vitest projects 与 per-file 100% 覆盖率门按 `packages/*/*` glob 零配置纳入（ADR 0007 预期成立）。

否决：清单作 spec 00 附录（可复用机械程序混入设计 frame，manager/evo 落地时须引 spec 附录）；仅存于 #13 resolution comment（可复用程序错存 tracker 评论）。

### 4. 地图收尾姿态：frontier 清空，地图常开

- 本票结案后 frontier 为空；批次 A–D 为纯执行，不再经 wayfinder 会话（决议已尽，拉去执行即地图边界）。
- 雾区唯一残片——EVO 架构级优化（AIP Evolve 第四维「消除不必要 LLM 调用」）的结构化数据源与变体粒度——仍不具备可票锐利度（候选 ledger+tool schema 未成形，待数据源讨论），留 Not yet specified 作路标；支柱④里程碑同步仪式开火、spec 04 深化时毕业为票。
- 地图 issue 保持开启，继续充当活索引。

否决：此刻就第四维立票（native blocking 无法表达「等支柱④里程碑」，它会以 unblocked/unclaimed 面貌现身 frontier 查询，招引输入尚不存在的过早会话）；关闭地图（destination——完整 spec——未达，雾区将失去活的家）。

## 后果

- 批次 A–D 即收尾计划；其后支柱②③④里程碑各按 ADR 0001 先行同步仪式，各章 skeleton 在各自里程碑内深化。
- 两个撰写期设计题归位：迁移机制 → 批次 B（spec 01）；bundle 行清单 → 批次 D（spec 00）。
- `docs/fork/` 目录建立：`adding-a-daypaw-package.md`（本批）+ `CORE_TOUCHES.md`（批次 C 首触时）。
- spec 00-overview 撰写时引用 ADR 0008 §1 图（包切分种子来自 ADR 0006 §1，落地形态来自批次 C 实况）。
