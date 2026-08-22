# ADR 0011: 客户自跑交付形态——产物分层与版本契约

- **状态**：已接受（2026-08-22，[客户自跑交付形态裁决：产物分层与版本契约](https://github.com/0xnicholas/daypaw-pro/issues/33)）
- **前置**：ADR 0001（上游同步与 checkpoint）、ADR 0008（落地批次）、ADR 0009（自用约束——本 ADR 修订其「无公开 API 稳定性承诺」一条）
- **事实底座**：`docs/research/deliverable-artifacts.md`（[dsh 可交付产物机制清点](https://github.com/0xnicholas/daypaw-pro/issues/32)）——npm bundle+CLI 机制最成熟（bundle 对包来源无约束、CLI 上游已实操 npm 发布）；单文件 exe 唯一有端到端证据（yao-pkg `--sea`，~174MB，无 Windows）；容器镜像零基础。

客户画像前提（2026-08-22 架构目标校准）：客户获取在即、环境完全未知，按最坏情况设计。

## 决策

### 1. v1 产物分层：npm 两层，同一发布线

- **库层 `@daypaw/sdk` 自含单包**——画像：有 Node 工程能力、把 durable execution 嵌进自己应用的开发者。
- **CLI 层自含单包**（`@daypaw/cli`，bin `daypaw`）——画像：不嵌代码、直接运营 agent 平台的使用者；安装收敛为 `npm i -g` 一条命令，daypaw profile 模板随包自带、首跑自初始化。

「自含」= 打包把全部运行时依赖（含上游 `@deepseek-ai/*` 包与 in-box bundle）打进单个 npm 包；上游包零改名、零 core touch，`@deepseek-ai` scope 被上游占用的问题随之消失。库层的 d.ts rollup 与 cordis 单例归属打包验证的待证项。

- **单文件 exe = fast-follow 预案**：触发 = 首个客户无 Node 或拒绝 Node；复用 yao-pkg 先例，已知限制不变（插件集封闭、无 Windows、~174MB、daypaw 包进闭包待验证）。
- **容器镜像 = 雾区**：仓库零基础，不动工；触发 = 客户环境只有 Docker。

否决：全套包改 scope 发布（每个上游 package.json 改名 = core touch 爆炸，与 ADR 0001 fork 卫生正面冲突）；私有渠道（GitHub Packages / tarball / git spec——客户侧认证摩擦，渠道运营成本自担）；v1 即做 exe 或容器（无具体客户环境约束则无法在二者间选型，且走骨期精力被摊薄）。

### 2. 版本契约

- **artifact 版本线独立（0.x），release 即 checkpoint 晋级**：每次发布打在 sync checkpoint 上，tag annotation / release notes 记录所含上游 sha（checkpoint 是「当前基线」的唯一权威记录，ADR 0001）；不跟随上游版本号。
- **定义版本与 artifact 版本正交**：`(def_name, def_version)` 是客户代码版本，随 run 行入 ledger（ADR 0003）；artifact 升级不改变定义版本语义。
- **不承诺跨 artifact 版本续跑在飞 run**：升级路径 = drain（无未完 run）或弃库重跑；ledger schema 迁移保证历史数据不丢（[spec 01 §4](../spec/01-durable-execution.md)：旧版逐段迁移、向后不承诺），引擎重放语义跨版本不冻结。ledger 中的定义版本记录是日后兑现该承诺的钩子。
- **SDK 公共 API 面 semver-ish**：0.x 内 breaking 变更只走 minor 版本，CHANGELOG 与 migration note 必带；内部 seam/插件面不承诺。

否决：承诺跨版本续跑（需跨版本重放测试面与重放语义冻结，v1 测试成本显著增加）；0.x 即承诺不破（锁死走骨期设计自由度，与上游 dev-preview 频繁 breaking 的现实冲突）。

### 3. 自用立场修订

ADR 0009 后果的「自用约束」修订为：单机、本地（无托管）、无多租户、无计费**不变**；「无公开 API 稳定性承诺」修订为 §2 的两级承诺（SDK 面 semver-ish + 不承诺跨版本续跑）；分发（自有 scope 的 npm 两层）进入范围。

## 后果

- spec 00 §3 的「暂不发布可安装 bundle 包」其触发条件（真实安装需求出现）已满足：发包形态落实为 CLI 自含包携带 profile 模板，而非独立 bundle 包；spec 00 §1 自用约束行与 spec 01 §4 迁移节同步回填本裁决。
- 首个公开发布 = 走骨（批次 C）落地后；发布前须完成自含打包验证（d.ts rollup、cordis 单例、profile 模板首跑自初始化）。
- 新增发布工程面：fork 侧 release workflow（从未跑过）、CHANGELOG 与 migration note 规程——计入走骨后首批任务。
- exe 与容器路径各带明确触发条件；条件满足时按[架构图](https://github.com/0xnicholas/daypaw-pro/issues/1)雾区条目毕业评估立票。
