# ADR 0001: 上游同步策略与 fork 卫生

- **状态**：已接受（2026-08-30，[上游同步策略与 fork 卫生](https://github.com/0xnicholas/daypaw-pro/issues/5)）
- **背景约束**：上游 deepseek-harness 处于 dev-preview：无 tag / 无 release、约 200 commit/天、明确承诺 breaking changes；本仓库为其 fork + in-tree 四支柱扩展（Durable Execution / Agent Engine+SDK / Manager / EVO）。

## 决策

### 1. 同步节奏：定期 merge + checkpoint

每 2–4 周（且每个支柱里程碑开工前**强制**）执行一次同步仪式：

```
git merge upstream/main
pnpm test          # 全绿才继续
git tag -a daypaw-sync/$(date +%F) -m "upstream: deepseek-ai/deepseek-harness@<sha>"
```

- 只用 merge，不用 rebase（上游速率下 rebase 不可行）。
- checkpoint tag 注释携带所合并的上游 commit sha——这是「当前基线」的唯一权威记录。
- 择机合并与冻结基线被否决：前者漂移非线性累积，后者与「保持 merge 可能性」的骨架决策矛盾且吃不到 dev-preview 阶段的密集修复。

### 2. 代码组织：新 family `packages/daypaw/`

四支柱全部作为**纯新增**包落在 `packages/daypaw/<pkg>` 下（durable-engine / sdk / manager / evo 等）。workspace glob `packages/*/*` 已覆盖，`pnpm-workspace.yaml` 零改动。不改上游任何 family 的文件；profile/bundle 接线走自有 profile（见 §4）。

### 3. 命名与版本：`@daypaw/*` + 独立 0.x

- 新包名一律 `@daypaw/<name>`，与上游 `@deepseek-ai/*` 空间零冲突、归属清晰。
- 版本各自独立 0.x 演进，`private: true`，不发布 npm。
- 上游基线**不进包版本号**，只由 checkpoint tag 携带（解耦，不污染 semver）。

### 4. core 触碰：seam 优先 + 登记例外

改动任何上游文件前依序自问：

1. 能否用**新 package + seam** 表达？（注意 `SessionEventMap` 是 merge-extensible，新增事件类型不需要碰 core。）
2. 能否用 `cordis.patch.yml` / 自定义 profile/bundle 覆盖？
3. 都不行 → 允许改，但必须：登记 `docs/fork/CORE_TOUCHES.md`（文件、原因、「上游 PR 候选？」标记），且每次 sync 逐个重放验证。

四支柱的组合通过自有 profile 表达（如 `daypaw` profile = dsh-base + daypaw bundles），不修改上游 base bundle 的内容。

### 5. 既有机制的取舍

- `vendor/`（上游 pin Cordis 的机制）：**不用于**同步策略，跟随上游。
- `patches/node-pty`：跟随上游。
- 上游回赠：core-touch 中标记为 PR 候选的改动，成熟后向 deepseek-harness 提 PR；被接受的改动在下一次 sync 后从 CORE_TOUCHES.md 划掉。

## 后果

- 冲突面被压到：CORE_TOUCHES 登记项 × profile 接线处 × README 索引（后者可选择不更新）。
- 同步成本可预测：每次 sync 的工时 ∝ 登记的 core-touch 数量，而非上游 commit 量。
- 若某次 sync 冲突失控，逃生通道是退回上一个 checkpoint tag 重切。
