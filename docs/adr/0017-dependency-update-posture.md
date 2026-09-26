# ADR 0017: fork 的依赖更新姿态——版本更新逐 ecosystem 抑制（`open-pull-requests-limit: 0`）

- **状态**：已接受（2026-09-21，[依赖政策复议：fork 停用 dependabot 版本更新](https://github.com/0xnicholas/daypaw-pro/issues/141)）；2026-09-23 §3 补安全更新两族的裁法（[安全更新 PR 的裁法](https://github.com/0xnicholas/daypaw-pro/issues/145)）；2026-09-26 §4 补冻结后条款，§2 与 §3 中子目录家族的「随同步仪式进入」随之作废（[ADR 0019](0019-freeze-posture.md)）
- **前置**：ADR 0001（同步策略与 fork 卫生——§1 merge 策略、§4 core 触碰三问、§5 既有机制取舍）
- **事实底座**：`.github/dependabot.yml` 是上游文件（fork 差异 = 决策 1 的三行抑制），每日 04:00 CST 运行、每轮开出约 10 张版本更新 PR；上游全史 18,059 条提交中 dependabot 署名 8 条，全部落在该文件首次配置起 24 小时内，其后 11,318 条提交零条；上游 `/pulls` 面不可读（`open_issues_count: 0`），其未合并的依赖票无从观察；上游 30 天内 `pnpm-lock.yaml` 635 次提交、`.github/workflows` 114 次提交；上游对该文件全史 5 次编辑，最近一次 2026-08-08；Advanced Security 页对 "Dependabot version updates" 无 Disable 开关（只有 Enable/Configure），官方文档的整体关闭途径是删除该文件。

## 决策

### 1. 版本更新在 fork 停用，机制是逐 ecosystem 的 `open-pull-requests-limit: 0`

`.github/dependabot.yml` 的三个 ecosystem（npm / uv / github-actions）各增一行 `open-pull-requests-limit: 0`：Dependabot 仍按日程检查，但不开 PR。该文件是上游文件，这三行是本 fork 的差异，登记 [CORE_TOUCHES](../fork/CORE_TOUCHES.md)，随同步仪式重放保留；树内指针由 [README-daypaw.md](../../README-daypaw.md) 的「与上游 dsh 的关系」一节承担。

### 2. 依赖版本随上游的依赖升级经同步仪式进入

fork 不自行接受版本更新票。上游的依赖升级以人工提交为主，随同步仪式（ADR 0001 §1）进入 fork；上游未升的包在 fork 里保持旧版本。fork 自有包（`packages/daypaw/*`、`apps/daypaw-web`）需要动依赖时直接改自己的 manifest——不经登记、不与上游冲突。

**2026-09-26 起（ADR 0019）**：同步仪式不再执行，本条的进入通道改为 §4。

### 3. 安全更新保留

Dependabot alerts 与 security updates 保持开启（仓库设置；前置条件 = dependency graph 开启）：依赖出现 CVE 时仍开 PR，逐票人工裁。交付物是客户自跑的 npm 包（ADR 0011），这一面比常规版本升级重要。`open-pull-requests-limit: 0` 只抑制版本更新，安全更新不受影响——官方文档正是以该值作为「只要安全更新」的配方。

安全更新票按 alert 所在 manifest 分两族，各有裁法：

- **根家族**（根 `package.json` 与根 `pnpm-lock.yaml` 上的 alert）：dependabot 经本文件的 `/` 条目开出的 PR 同时改根 lockfile 与相关成员 manifest，可并。唯一卡点是 pnpm 11 默认 `minimumReleaseAge: 1440`（1 天）的发布时长窗口：被升级或新解析出的条目发布不足一天时，`pnpm install --frozen-lockfile` 以 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 拒装；窗口一过，同一 lockfile 重跑即绿。裁法＝等窗口过去、重跑车道、绿即并；不为省一天加 `minimumReleaseAgeExclude` 精确豁免（一行豁免＝一行 fork 差异 + 每次 sync 的重放面，且削弱该政策自身的覆盖面）。
- **子目录家族**（`website/`、`apps/desktop/` 等成员 manifest 上的 alert）：dependabot 从子目录开出的 PR 只改该 manifest、不带根 lockfile——pnpm workspace 的 lockfile 只在根，子目录 update run 结构上写不了它（dependabot-core [#11135](https://github.com/dependabot/dependabot-core/issues/11135) 把这种拆分记为配置误用），故 `Install (immutable)` 结构性必红，补 `dependabot.yml` 目录条目也救不了。裁法＝视为信号、不并；修复随上游的依赖升级经同步仪式进入（同决策 2）。判据是交付面而非告警数：这两个面是上游零改动面，且不在 fork 交付物内（release 只打 `@daypaw/cli` + `@daypaw/sdk`）。

被关闭的安全更新票会被后续 dependabot 运行重新开出（同源两票即一例），重复出现不改变裁法。

## 考虑过的替代方案

**逐票关闭 + `@dependabot ignore <级别>`**：回执把忽略记在**被提议的那个版本**上（"I won't notify you about version 7.x.x again"），目标随即降为下一个未被忽略的大版本并重开——`actions/cache` 忽略 6.x 后开 4→5、`actions/checkout` 忽略 7.x 后开 4→6、`actions/download-artifact` 忽略 8.x 后开 4→7、`@vitejs/plugin-react` 忽略 6.x 后开 4.7.0→5.2。不收敛，且换新依赖面时无从覆盖。

**合入这类 PR**：票内 diff 与上游高频面混合（lockfile、workflows），在几乎每次同步挂冲突，与 ADR 0001 §1 的 merge 策略相抵；fork 内也无法完整验证——继承的上游工作流在 fork 必红，只有 fork 自有车道可跑。

**在仓库设置里停用**：不可行。Advanced Security 页对 "Dependabot version updates" 只有 Enable/Configure，没有 Disable 开关；官方文档（Disabling Dependabot version updates）给出的整体关闭途径是删除 `dependabot.yml`，GitHub 关于该设置行的 changelog 也只描述「配置文件存在时提供访问」。

**删除 `.github/dependabot.yml`**：官方文档的整体关闭途径。代价是上游文件在 fork 里消失——上游每次编辑该文件都是 modify/delete 冲突，fork 也失去该文件随 sync 更新的通路。三行抑制把冲突面压到相邻 hunk 并保住文件本体，故不取。

## 后果

- PR 列表不再出现版本更新票；继承车道的 fork 必红（`Build PR preview` 缺 Cloudflare 凭据）也不再借新 PR 反复出现。
- fork 的依赖版本取决于上游何时手改依赖：上游未升的包在 fork 里保持旧版本，fork 侧需要提前升级时手改自有 manifest。
- `.github/dependabot.yml` 是 fork 改过的上游文件（三行抑制 + 文件头三行理由注释），随同步仪式重放；上游编辑该文件时按相邻 hunk 冲突处理。若上游将来重新消费 dependabot 版本更新，本决策不受影响——抑制只作用于本 fork 的仓库面。
- 安全更新面留有两个常备动作：根家族票只在发布时长窗口上是红的，窗口过后重跑 fork 车道即并；子目录家族票关闭并指向本条 §3。

## 补条（2026-09-26，ADR 0019 冻结姿态）

### 4. 冻结后：依赖不再随上游走动

- **进入通道收窄为两条**：第 1 层的 dependabot security updates（仓库设置，直接更新 lockfile），与第 2 层的人工 cherry-pick（`packages/llm/**` 的 provider 适配提交 + 安全类提交），细则见 [ADR 0019](0019-freeze-posture.md) §1。
- **§2 的同步通道作废**：上游的依赖升级不再自动进入本仓库。上游未升的包继续停在当前版本，需要提前升级时改自有 manifest。
- **§3 子目录家族的指向改变**：原先「修复随上游的依赖升级经同步仪式进入」，现改为「等待第 2 层的人工评估」——该面不在本仓库交付物内（release 只打 `@daypaw/cli` + `@daypaw/sdk`），仍按信号处理。
- **`.github/dependabot.yml` 的三行抑制**由 core touch 转为永久分歧，登记性质改变见 [CORE_TOUCHES](../fork/CORE_TOUCHES.md)。
