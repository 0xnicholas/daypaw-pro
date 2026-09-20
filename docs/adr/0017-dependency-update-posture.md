# ADR 0017: fork 的依赖更新姿态——版本更新在仓库设置停用

- **状态**：已接受（2026-09-21，[依赖政策复议：fork 停用 dependabot 版本更新](https://github.com/0xnicholas/daypaw-pro/issues/141)）
- **前置**：ADR 0001（同步策略与 fork 卫生——§1 merge 策略、§4 core 触碰三问、§5 既有机制取舍）
- **事实底座**：`.github/dependabot.yml` 在 fork 与上游逐字节相同（每日 04:00 CST 运行），每轮开出约 10 张版本更新 PR；上游全史 18,059 条提交中 dependabot 署名 8 条，全部落在该文件首次配置起 24 小时内，其后 11,318 条提交零条；上游 `/pulls` 面不可读（`open_issues_count: 0`），其未合并的依赖票无从观察；上游 30 天内 `pnpm-lock.yaml` 635 次提交、`.github/workflows` 114 次提交；上游对该文件全史 5 次编辑，最近一次 2026-08-08。

## 决策

### 1. 版本更新在 fork 停用，开关取仓库设置

在仓库 Settings → Advanced Security 的 Dependabot version updates 停用。`.github/dependabot.yml` 保持上游原样：零 fork 差异、零 `docs/fork/CORE_TOUCHES.md` 登记行、同步仪式零重放。该开关无 REST API，只能由仓库 owner 在 GitHub UI 操作——政策本身落在树外，树内由 [README-daypaw.md](../../README-daypaw.md) 的「与上游 dsh 的关系」一节指向本 ADR。

### 2. 依赖版本随上游的依赖升级经同步仪式进入

fork 不自行接受版本更新票。上游的依赖升级以人工提交为主，随同步仪式（ADR 0001 §1）进入 fork；上游未升的包在 fork 里保持旧版本。fork 自有包（`packages/daypaw/*`、`apps/daypaw-web`）需要动依赖时直接改自己的 manifest——不经登记、不与上游冲突。

### 3. 安全更新保留

Dependabot alerts 与 security updates 保持开启：依赖出现 CVE 时仍开 PR，逐票人工裁。交付物是客户自跑的 npm 包（ADR 0011），这一面比常规版本升级重要。

## 考虑过的替代方案

**逐票关闭 + `@dependabot ignore <级别>`**：回执把忽略记在**被提议的那个版本**上（"I won't notify you about version 7.x.x again"），目标随即降为下一个未被忽略的大版本并重开——`actions/cache` 忽略 6.x 后开 4→5、`actions/checkout` 忽略 7.x 后开 4→6、`actions/download-artifact` 忽略 8.x 后开 4→7、`@vitejs/plugin-react` 忽略 6.x 后开 4.7.0→5.2。不收敛，且换新依赖面时无从覆盖。

**合入这类 PR**：票内 diff 与上游高频面混合（lockfile、workflows），在几乎每次同步挂冲突，与 ADR 0001 §1 的 merge 策略相抵；fork 内也无法完整验证——继承的上游工作流在 fork 必红，只有 fork 自有车道可跑。

**fork 侧改 `.github/dependabot.yml`（`open-pull-requests-limit: 0`）**：抑制效果与仓库设置相同，代价是上游文件上一条永久差异 + 登记行 + 上游每次编辑该文件时的重放（实测约每季度一次）。仓库设置路线零差异，故不取。

## 后果

- PR 列表不再出现版本更新票；继承车道的 fork 必红（`Build PR preview` 缺 Cloudflare 凭据）也不再借新 PR 反复出现。
- fork 的依赖版本取决于上游何时手改依赖：上游未升的包在 fork 里保持旧版本，fork 侧需要提前升级时手改自有 manifest。
- `.github/dependabot.yml` 仍是上游文件，随同步仪式更新；若上游将来重新消费 dependabot 版本更新，本决策不受影响——fork 的开关是仓库设置，与上游合并进来的文件内容无关。
