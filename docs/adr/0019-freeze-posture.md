# ADR 0019: 冻结姿态——上游从「权威」降级为「依赖」

- **状态**：已接受（2026-09-26，[冻结姿态：上游从「权威」降级为「依赖」](https://github.com/0xnicholas/daypaw-pro/issues/153)）
- **前置**：ADR 0001（本 ADR 取代其 §1 同步节奏与 §4 的 core-touch 重放义务，保留 §2 fork 卫生、§3 命名与版本）；ADR 0017（依赖更新姿态，本 ADR 补其冻结后条款）；ADR 0015 §4（上游无接受通道）
- **事实底座**：41 天（2026-08-16 → 2026-09-26）190 个 fork 提交中 143 个（75.3%）落在 sync 重放、gate/CI 修复、文档裁决与笔记行文审计；产品功能提交 30 个（15.8%），最后一个落在 2026-09-19。实测同步间隔平均 9.5 天（最长 11 天），每窗吞 1,311–2,188 个上游提交，2026-09-24 一次为 3,165 个提交、44 个冲突文件、七波重放。`docs/fork/CORE_TOUCHES.md` 有 47 行 live 登记，其中 25 行标「上游 PR 候选」，而 `CONTRIBUTING.md` 声明 *"we cannot accept external pull requests at the moment"*，官方通道是发布 `dsh-plugin` 主题的社区插件。47 行中 2 行是不可避免的 fork 专属改动（`packages/client/ui-theme` 默认亮色、`apps/web/tests/assembled-boot.ts` 归属反转），12 行是上游缺陷或通用改进，其余为加性登记与 gate 例外。`packages/daypaw/{store,engine,sdk}` 对上游文件零接触。

## 决策

### 1. 上游准入的三层规则

**第 1 层（零动作）**：dependabot security updates。`.github/dependabot.yml` 逐 ecosystem 的 `open-pull-requests-limit: 0` 只抑制版本更新；安全更新读仓库设置而非该文件，保持启用并直接更新 lockfile。

**第 2 层（按需 cherry-pick）**：范围钉死两块——`packages/llm/**` 的 provider 适配提交（模型 API 变化是本仓库无法自行承担的外部依赖），与安全类提交（`packages/sandbox/**`、`packages/shell/**`、`packages/session/**` 的解析与校验修复）。触发方式为被动（坏再挑）加每季度一次 30 分钟盘点（`git log upstream/master --since=<三个月前> -- packages/llm/`）。挑进的提交必须过 `check:ci:daypaw-hosted` 全门。

**第 3 层（永不）**：整体 merge。确需吸收一个窗口的上游改动时，开一次性手术分支完成、随后删除；不恢复日常仪式。

### 2. remote 与 tag 保持现状

`upstream` remote 保留为 fetch-only，供第 2 层挑拣与季度盘点使用。`daypaw-sync/<日期>` 四个 tag 保留为历史记录，不重写、不删除。依赖版本经第 1 层安全更新或人工评估进入本仓库，不再由上游的依赖升级带入（补 ADR 0017）。

### 3. `CORE_TOUCHES.md` 改写为改动记录

表的用途从「同步重放的义务台账」改为「本仓库对上游文件的改动记录」：表头删除重放义务句，第四列 `上游 PR 候选？` 改名 `性质`，取值三类——`通用改进`（上游缺陷或可通用化的修复，如 loader 安定屏障、ACP stdio 连接时序、lefthook 生产安装容错）、`fork 产品决策`（`ui-theme` 默认亮色、`assembled-boot` 归属反转）、`fork 交付形态`（entrypoint allowlist、发布 carve-out、roster 行）。标「可提」的 25 行按实际性质改写：无外部 PR 通道，它们是永久分歧。

### 4. 同步专用机械退役

删除 `scripts/fork/sync-preflight.ts` 与其 spec（959 行）以及根 `package.json` 的 `sync:preflight` 脚本行；该工具服务整体 merge，服务对象已不存在，且它在 CI 中未挂载。`.agents/notes/implemented/` 内以同步重放与 fixture 迁移为主题的笔记按 [dsh-archive-agent-notes](../../.agents/skills/dsh-archive-agent-notes/SKILL.md) 的程序归档，并从 root `AGENTS.md` 的指引面摘除。

### 5. roster 检查降级为自洽检查

`scripts/verify-cordis-config.ts` 的 roster 镜像检查改为自洽检查：每条浏览器行指向的包必须在 workspace 中存在并声明 `dsh.client`；`ROSTER_TRIMS` 从「相对上游的有意裁剪」变为普通 roster 数据。上游 bundle 文件仍在树内（冻结的一部分），不再作为比较基准。

## 考虑过的替代方案

**完全断链（`git remote remove upstream`，自持整棵树）**：拒绝。保留一个 fetch-only remote 的成本接近零，收益是模型适配层这个无法自行承担的外部依赖仍有来源。

**包化（dsh 全族改为 npm 依赖，fork 退化为独立仓库的 profile + 插件族）**：本窗口不执行。上游包已发布（`@deepseek-ai/dsh-base`、`dsh-web-app`、`dsh-agent`、`dsh-client-ui-slots` 等，均可从 registry 取到），技术上可行；但发布版本落后于本仓库所在源码（npm 上为 `0.0.1-rc.1` / `0.1.0-rc.6`，本仓库所在源码为 0.1.7-rc.1），且 14 行改上游行为、14 行 gate 例外与 roster 组成都需要另找落点。冻结姿态不排除它，它作为后续独立裁决保留。

**维持定期 merge（ADR 0001 §1 原状）**：拒绝。75.3% 的产能占用与只涨不跌的登记行数（批次 C 时 28 行、2026-09-24 后 47 行）是该策略的直接后果。

## 后果

- 本仓库自持 337,484 行上游源码（`packages/` 非 daypaw 部分）及其全部缺陷；上游不再修复本仓库树内的任何东西。
- 模型 provider 适配是唯一约定的跟进项；其余上游行为冻结在本仓库当前包含的上游 tip（2026-09-23）。
- 安全更新通道不受影响：dependabot security updates 读仓库设置而非 `open-pull-requests-limit`。
- `CORE_TOUCHES.md` 的登记行不再是重放清单，维护动作只剩「新改动落地时追加一行」。
- 同步仪式段随同改写：`README-daypaw.md`、`CONTEXT.md` 的「同步仪式」/「Checkpoint」/「Core-touch」三条、`docs/fork/adding-a-daypaw-package.md` 的 core-touch 登记节。
- 恢复整体 merge 的成本随时间上升：本仓库当前包含上游 tip 的全部提交，漂移越久，一次性手术分支的规模越大。
