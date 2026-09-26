# ADR 0021: 交付形态改判——按客户定制的构建，tarball 通道

- **状态**：已接受（2026-09-26，[交付形态改判](https://github.com/0xnicholas/daypaw-pro/issues/161)）
- **前置**：ADR 0011（客户自跑交付形态——**本 ADR 取代其 §1 的产物分层与渠道裁决**，保留 §2 的版本契约立场与 §3 的自用立场修订）；ADR 0019（冻结姿态）；ADR 0020（壳留在 dsh）
- **事实底座**：
  - ADR 0011 的画像前提是「客户获取在即、环境完全未知」（2026-08-22）。五周后：仓库 122 个 issue 全部由本仓库自开自关，**0 个外部 issue、0 个外部 PR、0 次对外动作**；`@daypaw/cli` 与 `@daypaw/sdk` 至今 npm E404。
  - 2026-09-26 实测 pack 路径全绿：`daypaw-cli-0.1.0.tgz` / `daypaw-sdk-0.1.0.tgz` → 全局安装进临时 prefix → `daypaw --port 0` 起壳（URL 行 / dist 服务 / 浏览器首渲染 / profile 播种 / 引擎账本五项）→ 另建消费方工程 `tsc` 通过并真跑一个 workflow（`RESULT {"total":50}`）。
  - 定制面现状：T1（客户自己的 profile patch 行、`daypaw/agents/` 的注入式工厂、设置页）与 T2（客户自有插件包经 `dsh.bundle.patch` / profile 挂载）今天即可表达；T1 的落点已按设计归客户所有（`@daypaw/engine` 行播种进**客户 profile 自己的** `cordis.patch.yml`，可 retune/remove）。
  - 本轮交付模型的答案：按客户要求定制，只对目标客户发。

## 决策

### 1. 交付物是按客户定制的构建，通道是 tarball

交付动作 = 针对一个客户构建、把 `pnpm run release:daypaw` 产出的 tarball 交给他。公开 registry 休眠：`publishConfig`、`scripts/release/publish-daypaw.wizard.sh`、release 车道的 publish job 全部保留但不运行。

### 2. 定制层级：T1 与 T2 可达，T3 排除

- **T1 配置级**：客户 profile 的行、`daypaw/agents/` 下的定义、设置页。零代码改动。
- **T2 插件级**：客户自有的工具/面板包，经 bundle 或 profile 行挂进他的组合。
- **T3 源码级（改 daypaw 自己的壳/引擎）排除**：冻结点之上没有可对齐的上游，每个 T3 客户就是一条要独立维护的分支。需要 T3 的需求要么改判需求，要么作为一次独立裁决提出。

### 3. 模型 key 由客户自带

客户用他自己的 DeepSeek key，计费归他。交付不包含、不代付、不转发任何凭据。

### 4. 对外动作只指向目标客户

不公开发布、不公开宣布、不做产品化落地页。README 与包文档面向的是**拿到 tarball 的人**，不是匿名访客。

### 5. 顺序：需求先于形态

定制层级与交付细节由第一个客户的真实需求反推。需求到手之前，不再新增任何为交付而建的代码。

## 考虑过的替代方案

**维持 ADR 0011 §1 的公开 npm 两层自含单包**：拒绝。一个公开 artifact 不可能同时是 N 个客户的定制构建——这是模型级的互斥，不是取舍。ADR 0011 对私有渠道的否决理由（「客户侧认证摩擦、渠道运营成本自担」）在**单客户、一次性交付**下不成立：交付摩擦由交付人当面承担一次，而 registry 运营成本在只有一个客户时是纯支出；其决定性前提（客户获取在即）也未在五周内兑现。

**私有 registry（GitHub Packages 或自建）**：等第二个客户再付这笔成本。当前零基础设施的 tarball 已经走通并有实测证据。

**容器镜像 / 单文件 exe**：触发条件不变——客户环境只有 Docker / 客户无 Node 且拒绝 Node。两者都仍只是预案（ADR 0011 §1 的 fast-follow 与雾区裁决继续有效）。

## 后果

- 交付路径的实测证据面扩大为「tarball → 安装 → 起壳 → 真干活」，且不再需要 registry 凭据。
- 每个客户的构建是一次 `release:daypaw` 运行；本机跑完要补一次 `pnpm install`（pnpm deploy 的 hoist 残留）。
- 定制诉求只要落在 T3，就会立刻变成独立维护的分支——因此 T3 需求是升级信号，按 ADR 0020 §2 的触发条件处理，而不是就地开分支。
- ADR 0011 继续有效的部分：`@daypaw/cli` / `@daypaw/sdk` 两个可发布例外的 manifest 形态、版本契约的立场（不承诺跨 artifact 版本续跑在飞 run）、以及 §3 对自用约束的修订。
- 公开 registry 路径休眠不等于删除：若将来出现「客户要自己从 registry 装」的需求，发布向导与 publish job 是现成的。
