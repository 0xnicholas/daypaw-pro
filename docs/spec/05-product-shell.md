# 第 5 章：产品壳（Product Shell）

> 状态：**完整章**（map #35 收官章——路线、IA、词汇、交付、后端缺口、权限、品牌全部裁决完毕，可移交实施）。决策依据（全部为 issue resolution，无对应 ADR）：[map #35](https://github.com/0xnicholas/daypaw-pro/issues/35)（域图与范围）、[#36](https://github.com/0xnicholas/daypaw-pro/issues/36)（路线 B 与复用边界）、[#39](https://github.com/0xnicholas/daypaw-pro/issues/39)（IA）、[#40](https://github.com/0xnicholas/daypaw-pro/issues/40)（词汇映射）、[#41](https://github.com/0xnicholas/daypaw-pro/issues/41)（交付集成）、[#44](https://github.com/0xnicholas/daypaw-pro/issues/44)（后端缺口闭合）、[#45](https://github.com/0xnicholas/daypaw-pro/issues/45)（设置 IA 与首跑）、[#46](https://github.com/0xnicholas/daypaw-pro/issues/46)（权限模型）、[#48](https://github.com/0xnicholas/daypaw-pro/issues/48)（视觉品牌）。交付分层与版本契约的上位约束：[ADR 0011](../adr/0011-customer-self-run-delivery.md)。章节状态索引见 [README](README.md)。

## 1. 定位与范围

产品壳 = 面向非技术业务用户的完整产品前端（不是开发者工具，也不是支柱③ Agent Manager 的复活）：用户用 agent 干活——发任务、看进度、批审批、管理 agent 目录与设置。四个产品板块：**agent 对话、任务进度、审批待办、agent 目录与设置**（IA 落位见 §3——对话即中栏工作区）。交付形态 = 随 `@daypaw/cli` 自含 npm 包自跑（[ADR 0011](../adr/0011-customer-self-run-delivery.md) 两层分层的 CLI 层）；ADR 0011 本身不含 web UI 承诺，本章是该承诺的落点。范围外（map #35 out-of-scope）：Manager 的运营观测面（trace/timeline/fleet 深度工具）、EVO 界面、多租户托管部署与认证体系。

## 2. 词汇映射（裁决 [#40](https://github.com/0xnicholas/daypaw-pro/issues/40)）

词汇的家是根 [CONTEXT.md](../../CONTEXT.md) 的「产品壳（Shell 呈现域）」节；本节只给速览与呈现层约定，不另立第二份词汇。

| 引擎概念 | 业务呈现 |
|---|---|
| run | **任务** |
| `running` / `waiting` / `done` / `failed` / `cancelled` | 进行中 / 等待确认 / 已完成 / **出错了**（配「重试」）/ 已取消 |
| 挂 pending 审批的 run | 派生态**「等待你确认」**——审批面 join 呈现，不是引擎状态 |
| 崩溃复活（boot 扫描续跑） | **不可见**——引擎韧性不产生业务文案 |
| 父子 run 血缘 | 列表只显示顶层任务；子任务收父任务详情内嵌；`ctx.spawn` 火后不管子 run 在详情单列一节 |
| run 进度 | agent run = 对话动态的业务语言投影；workflow run = step 名时间线 |
| 审批待办 | 「<任务名> 请你确认：<业务动作摘要>」+ **同意 / 拒绝**（拒绝可附言回对话）；原始命令/路径收详情展开 |
| agent 定义 | 目录卡片 = 业务名 + 描述；`name@version` 收详情页（v1 无版本操作入口） |

呈现层约定两条：呈现词汇只在 UI 文案与 spec 呈现层使用，引擎/ledger/SDK/session 层仍只认 run 等原名，不存在代码层改名；workflow 的 step 名是定义作者的业务文案义务（写业务可读短语，defineWorkflow 侧约定）。

## 3. 板块与 IA（裁决 [#39](https://github.com/0xnicholas/daypaw-pro/issues/39) / [#45](https://github.com/0xnicholas/daypaw-pro/issues/45)）

IA 定案 = **变体 C 收件箱工作台**，三栏：

- **左栏（导航）**：最显眼元素 = 大「+ 新任务」按钮（点击弹 agent 选择面板）；其下收件箱式分组「等待你确认 / 进行中 / 已完成」（含计数）；底部次要导航 = Agents、设置。
- **中栏（工作区）**：当前选中项的工作区——进行中的任务显示对话流，待确认任务的审批卡置顶。
- **右栏（详情）**：选中任务的详情——进度、子任务内嵌（spawn 子任务单列一节）、产出物、审批历史。

四板块落位：审批待办 = 收件箱顶部分组（跨任务聚合，不是独立主导航项）；任务进度 = 收件箱的进行中/已完成分组；agent 目录 = 次要导航页 + 新任务弹窗；设置 = 次要导航页。板块联动：审批卡同意/拒绝 → 任务从「等待你确认」回到「进行中」；点收件箱条目 → 中栏切到该任务对话；对话内产生的审批实时进收件箱顶部分组。三栏骨架由 `ui-layout` 整包复用供给（§4）。

**设置板块**（#45 取 A）：单面页（#46，不分人设层），左侧分区 tab + 右内容区。分区：**通用**（语言；主题/密度为 §7 范围，先占位）、**凭据**（按 provider 分行的 API key 设置/更新/移除；未配置带警告点）、**模型**（dsh 完整形态：provider 分组 + 模型卡 + effort 档位，§4 `ui-model-selection` 裁决）、**关于/诊断**（版本号、诊断信息复制）。`ui-settings-general` 的落法：onboarding ledger 机械保留（一次挂一步、registrant 自拥完成态），壳体与 General 段内容重画为上述单面页。

**首跑**（#45 取 C）：无独立首跑向导，用户直接落在收件箱工作台。首跑 = 一次挂一张的内嵌引导卡：选完 agent 后若未配凭据，对话区顶部出现「<agent 名> 需要 API key 才能开始工作」黄卡（「去设置里配置」跳到设置页凭据 tab，输入框在配好前保持禁用）；配完 key 卡自动消失 = 这一步的完成态（onboarding ledger 机械承载）。自含包**不预置凭据**；未配 key 是首跑的默认态，不是异常态。

原型存档（三变体全量，throwaway，不进 main）：分支 [prototype/shell-ia-39](https://github.com/0xnicholas/daypaw-pro/tree/prototype/shell-ia-39) 的 `docs/fork/prototypes/shell-ia.html` 与分支 [prototype/settings-first-run-45](https://github.com/0xnicholas/daypaw-pro/tree/prototype/settings-first-run-45) 的 `docs/fork/prototypes/settings-first-run.html`；两份原型的调色板不权威，主题方向以 §7 为准。

## 4. 复用边界与包结构（裁决 [#36](https://github.com/0xnicholas/daypaw-pro/issues/36) / [#41](https://github.com/0xnicholas/daypaw-pro/issues/41)）

**路线 B**：fork 自有 profile 托管自有 dist（仿 `web-runtime` 胶水换 dist 指向），随 `@daypaw/cli` 自含交付自跑。否决：路线 A（自含包内没有前端静态资源的落地方式，托管问题原样推迟）；路线 C（SDK 协议对话面大半缺失，v1 需整体补面 + 自写后端翻译层，成本最高且不换来 v1 需要的东西）。

**复用边界**（39 包，[#37](https://github.com/0xnicholas/daypaw-pro/issues/37) 盘点 + #36 裁决）：

- **整包复用（13）**：connection、runtime、modules、web、web-react、ui-slots、locale、schema-form、ui-settings、ui-theme、ui-primitives、ui-attachment、hmr——协议/对象层 + boot 内核 + 服务基座 + 纯组件基料，无一携带开发者向文案；数据管道零重写，工程量集中在 IA 与组件。
- **wholesale 重写（15）**：会话表现簇与 IA/品牌/诊断面（ui-conversation、ui-tool、ui-workflow-run、ui-trajectory、ui-sidebar、ui-workspace、ui-directory-picker-browse/-native、ui-subagent、ui-goal、ui-plan、ui-agent-preset、ui-settings-models、ui-settings-plugins、ui-settings-plugin-inventory），业务语言版从 runtime 的 ConversationNode 装配机供数重画；其中 ui-trajectory、ui-settings-plugins、ui-settings-plugin-inventory 实为不随壳交付。
- **灰色 11 包逐包裁决**：

| 包 | 裁决 | 备注 |
|---|---|---|
| ui-layout | 整包复用 | v1 主框架保留「导航/对话/详情」三栏同构；响应式/窄视口见 §8 |
| ui-commands | 整包保留 | 命令面与 dsh 前端同形态 |
| ui-input-trigger | 整包保留 | 同上 |
| ui-skill | 整包保留 | 同上 |
| ui-model-selection | 整包沿用 dsh 形态 | 与「非技术业务用户」画像的张力挂 §8 对账 |
| ui-user-questions | 重写 | 审批 = 跨任务待办收件箱 + 对话内即时卡双呈现；pending 重放等机械由复用侧 connection/apiproxy 供给，后端零新面 |
| ui-deliverables | 进 v1，重写 | run 详情产出物区；识别依据从工具 render intent 换成 run `output_json` |
| ui-jobs | 不进 v1 | dsh 进程内 jobs ≠ durable run；壳词汇只认 run |
| ui-message-feedback | 不进 v1 | EVO 远期；宿主侧关联层已接，捡回零成本 |
| ui-settings-general | 收口 | ledger 机械留、壳体重画，见 §3 |
| ui-permission-presets | 不进 v1 | 见 §6 |

**包结构**（#41，镜像上游分层）：

```
apps/daypaw-web/        @daypaw/web-frontend（预留）   fork 前端源码（vite 构建 dist/，files: [dist]；对应上游 apps/web）
packages/daypaw/
└── (预留) web-app/                              fork 胶水 bundle（对应上游 packages/bundle/web-app）
```

胶水 bundle 对上游只改四点：`require.resolve` 的 dist 包名指向、`webSurfacePrompt()` 文案、`DSH_WEB_URL` env 名、`dsh web:` URL 行前缀。

**profile**：`daypaw` profile 演进为产品壳——`DAYPAW_PROFILE_BUNDLES` 增列 fork web-app bundle，`daypaw` 命令直起壳；`@daypaw/engine` 行保持用户 patch 层播种先例（客户可 retune/remove）。TUI agent 面随 web patch 禁用是 web 组合既定行为；headless 需求由库层（`@daypaw/sdk`）与上游 profile 承接，CLI 层不背。

**打包与版本线**：dist 是构建期产物——pack 前构建，随 `pnpm deploy` 闭包 + `bundleDependencies` 进 tarball，安装期零构建，打包管线零改动。版本硬绑定同一 artifact 版本线：dist 与引擎同 commit 构建、`bundleDependencies` pin 死、无独立前端版本线，升级 = 整包升级（与 ADR 0011「不承诺跨 artifact 版本续跑在飞 run」一致）。播种沿用 in-package 模板 + 首跑自初始化先例，不覆盖既有文件。

## 5. 后端面增量（裁决 [#44](https://github.com/0xnicholas/daypaw-pro/issues/44)）

引擎侧 v1 增量四项（core 保持无 Cordis 依赖形态；事件化若日后要做也在 core 外套层）：

- **`JournalStore` 查询面**：run 列表 + 状态过滤 + 血缘、按 run 的 journal step 时间线枚举，经 `ctx.durable` 暴露。查询知识收进引擎 seam——单一事实源，随 `SCHEMA_VERSION` 演进天然同步；否决 host 侧 SQL 散点方案。
- **定义注册表只读视图**：agent 目录页的 core 查询（注册表为 core 私有 Map，host 够不到）。
- **`defineAgent` 展示字段**：下限 = 业务名 + 描述，与注册表只读视图配套；集合细目落定 = `title` + `description`（spec 02 §1.2），未声明时呈现层回落到技术 `name`。
- **steer 通道**（用户裁决）：SDK/引擎加 steer，run 从单段变多段。呈现语义：对话中追问进行中的 run 追加进同一任务的对话流，不产生新任务；产出物以 run 终态 `output_json` 为准（§4 `ui-deliverables` 的识别依据），中间段不单独形成产出物区。

host 侧一项：**run 进度 live = host 轮询引擎查询面 + `sessionProjections`/mux 投影**（attach 路径 `pollMs` 为现成先例）。

缓做与不做：`ctx.waitFor` gate 原语缓做（[第 1 章](01-durable-execution.md) §6 既定引擎工作，另立引擎票 #47）；v1 审批待办板块只用 dsh 交互式审批面（apiproxy pending 聚合 + mux 重放，wire 闭环已全），「等待人审批的 run」业务语义随原语落地后升级；pending 审批 unary 查询不做（mux-open 重放即冷启动基线）；路线 C 对话面缺口随 #36 否决消灭。

## 6. 权限与安全模型（裁决 [#46](https://github.com/0xnicholas/daypaw-pro/issues/46)）

- **用户形态 = 单操作者无身份**：谁打开浏览器谁就是操作者，无登录、无身份、无归因；与自跑 LAN 信任栅栏及上游 `/api` 既有假设一致，零新面。
- **人设不切**：设置页单面（§3），运营向项（模型选择、凭据/provider 配置）平铺不藏不分层；v1 假设操作者 = 部署者本人（或小团队技术最熟者）。未来真人设需求出现时，「我的偏好」是单面页的自然子集，不返工。
- **`ui-permission-presets` 不进 v1**：权限预设切换 UI 不随壳交付。壳固定保守默认策略 = 敏感操作（文件写入/命令执行等）必审批，与审批待办板块（§3 收件箱 + 对话内卡，§2 同意/拒绝文案）闭环；策略可调性待运营面成型或真实客户要求再立案。

推论：v1 壳内不存在「权限」概念的用户可见面；**安全模型 = 审批待办板块本身**。共享实例/多用户与认证体系绑定，属 map out-of-scope（§8）。

## 7. 视觉品牌（裁决 [#48](https://github.com/0xnicholas/daypaw-pro/issues/48)）

- **名称**：产品壳 = **daypaw**——与 npm 包（`@daypaw/cli`）、CLI 命令、仓库名一致，零认知分叉；sidebar wordmark 换词，将来改名是 token 级改动（`ui-theme` 基座已复用，§4）。
- **主题气质**：暖橙 accent + 暖中性底——「帮手的桌面」而非「运维控制台」，与上游 dev 壳一眼可区分本身是品牌功能。
- **密度**：中偏低——留白多于上游 dev 壳，贴收件箱工作台的清爽队列感。
- **明暗**：亮主题默认，暗主题随 `ui-theme` 偏好服务（机制现成，无额外面）。
- **边界**：精确 token 值与间距值是实施期工作；本节只锁方向与 `--dsw-*` token 换肤指引。

## 8. 雾区与未决项

继承 map #35 的 Not-yet-specified，及以下挂账项：

- **移动端 / 响应式**：未裁决；三栏骨架的窄视口行为悬置（#39 明确不在其票内）。
- **通知**：任务完成、审批待办的站外触达未裁决；v1 壳内触达 = 收件箱分组计数 + 对话内审批卡。
- **多用户 / 认证**：共享实例形态与认证体系绑定，随托管部署留未来（map out-of-scope，§6）。
- **审批策略可调性**：固定保守默认之外的策略面待立案（§6）。
- **`ui-model-selection` 用户叙事对账**：dsh 完整形态与「非技术业务用户」画像的张力，写用户叙事时复核（#36 挂账）。
- **`ctx.waitFor` 落地后的语义升级**：「等待人审批的 run」业务呈现随原语落地升级（§5，引擎票 #47）。
