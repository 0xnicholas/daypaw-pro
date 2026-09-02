# dsh 可挂面清单：未挂载能力面的成本与定位依赖

> Wayfinder 研究票 [#97 「dsh 可挂面清单：未挂载能力面的成本与定位依赖」](https://github.com/0xnicholas/daypaw-pro/issues/97) 的成果，隶属地图 [#95 「daypaw 产品定位重审：为谁、露什么面」](https://github.com/0xnicholas/daypaw-pro/issues/95)。日期：2026-09-02。比对基线：fork main @ `dd6fae8380` vs 上游 `upstream/master` @ `49a606bc5b`（release 0.1.2-alpha.5）。一手来源：两侧 roster 的逐行 diff（`packages/daypaw/web-app/cordis.patch.yml` 全文 vs `upstream/master:packages/bundle/web-app/cordis.patch.yml` 全文，各 60 行）、上游各包 README 首段契约、fork yml 的 `disabled` 行、两个漂移窗的 git log（`cd5ef81481..4e84901e64` 已由 #78 findings 覆盖；`4e84901e64..49a606bc5b` 本票补看）。底册：[#37 复用盘点](https://github.com/0xnicholas/daypaw-pro/tree/research/client-reuse-inventory)（分支 `research/client-reuse-inventory`）、`docs/research/2026-09-02-upstream-drift-client-stack.md`（分支 `research/upstream-drift-client-stack`）。结论喂给 [#99 「定位裁决」](https://github.com/0xnicholas/daypaw-pro/issues/99) 与 [#100 「能力面清单逐簇裁决与双模式 IA 形态」](https://github.com/0xnicholas/daypaw-pro/issues/100)。

## 0. 先修正票面两处预设

1. **「未挂载」大半不成立**：票面点名的 ui-tool、ui-trajectory、ui-subagent、ui-plan、ui-goal、ui-jobs、ui-workflow-run 在 daypaw roster 里**全部已挂**（`packages/daypaw/web-app/cordis.patch.yml` 行 262/275/336/339 及邻近的 ui-subagent/ui-plan/ui-goal/ui-jobs/ui-workflow-run 行，均无 disabled）。真正的缺口在两层更深的地方：(a) **能力底座**——daypaw profile 把模型侧工具行整组禁用（yml 中 `tool-bash`/`tool-pwsh`/`tool-fs`/`tool-fs-search`/`tool-str-replace-editor`/`tool-web`/`tool-subagent` 族/`tool-jobs`/`tool-goal`/`tool-workflow`/`tool-todo`/`tool-skill`/`tool-ralph`/`tool-result-pruner`/`tool-subagent-*` 等 `disabled: true`，行 360 起），依赖这些生产者的 UI 面因「无事件可显」而**永久饿着**（下节逐面引 README 契约为证）；(b) **业务语言义务**——真正在工作的面（ui-tool 工具卡、ui-trajectory 事件账本）按其 README 契约渲染 verbatim 开发者数据。
2. **「壳无工具」双重实证**：seeded agent 全部 `tools: []`（`daypaw/agents/starter-assistant.mjs`、`note-lint.mjs`，运行目录实证）+ profile 工具行全禁 ⇒ 壳会话是裸模型 + `submit`。[#84 功能走查](https://github.com/0xnicholas/daypaw-pro/issues/84) 缺口③（审批待办无触发面、长期空转）的根因在此——不是 UI 缺面，是**敏感操作根本不存在**。

## 1. 真缺的 roster 行（6 行，其中 2 行已有裁决）

| 行 | 展示什么（上游 README 契约） | 上游现状 | 挂载成本 | 业务语言化成本 | 定位依赖 |
|---|---|---|---|---|---|
| `session-turn-outline` | 全日志 turn 导航投影，事件分页载入前即可跳 turn | 上游 web roster 默认启用 | **已裁接入**（[#92](https://github.com/0xnicholas/daypaw-pro/issues/92)，随下次 sync 收行） | 必要时 turn 节点文案走 #40 词汇映射 | 已定，不再裁 |
| `ui-attachment` | 附件的**全部视觉面**：composer 下待发图列、全屏拖放邀请、Chat/Trajectory/Tool 结果里的持久图、原图 lightbox；纯表现层，数据经 conversation 槽供给；README 明言「non-image files have no surface here」 | 活跃（alpha.5 窗内仍在修附件相关 image card） | **1 行 roster**（`- id: ui-attachment`），无 fork 代码 | ≈0（视觉面，无术语） | **低**——业务用户贴截图是自然需求，近乎白赚 |
| `ui-reference` | composer 的 `@` 引用源：`@file`/`@session` 统一候选列表（文件序先于会话、区块标签、目录下钻 Tab、原子内联引用） | 活跃 | 1 行 roster；依赖已挂的 file-reference-local/session-reference 服务行 | ≈0（README：区块标签本就 locale 注册） | **中**——业务用户引用文件的前提是其工作流里有文件心智；power 用户即刻受益 |
| `ui-schedule` | 当前会话活动提醒的只读目录（Web header） | 上游也 `disabled: true`，显式 overlay 才开 | **已裁挂账**（[#85](https://github.com/0xnicholas/daypaw-pro/issues/85) 裁决 1，镜像禁用态零成本） | — | 已定（功能走查后结合真实使用再评估） |
| `ui-sidebar` | 上游 web 的左侧栏壳：品牌行、New Session、56px 折叠 rail、底部 Settings 座、滚动区座 | 活跃 | **非缺失**——被 fork `ui-inbox` 导航有意替换（#39 IA 变体 C）；若双模式 IA 需要折叠 rail 可借 layout 件 | — | 随 #100 双模式裁决附带考虑 |
| `ui-brand-official` | 上游官方品牌层 | 活跃 | **非缺失**——被 `@daypaw/ui-brand` 替换（#61 暖橙 token 层） | — | 已定 |

## 2. 已挂但饿着的面（能力底座问题，非 UI 问题）

| 面 | roster | 生产者依赖（README 契约） | daypaw 表现 |
|---|---|---|---|
| ui-jobs | 已挂 | 读 host `jobsBySession` 镜像；「trigger appears only when the session has at least one job」 | `tool-jobs`/`tool-bash` 禁 ⇒ 永不出现 |
| ui-goal | 已挂 | composer-context 条带，读 goal 服务投影，goal 创建在插件外（`/goal` 命令属 tool-goal） | `tool-goal` 禁 ⇒ 条带恒空 |
| ui-plan | 已挂 | plan-mode 投影有效时显示 chip，「otherwise the seat stays empty」；plan mode 本体属 `dsh-plan-mode` host 插件，roster 无其行、挂载随 preset scope | 本 profile 无 plan 投影 ⇒ 恒空座 |
| ui-subagent | 已挂 | 父会话 header 的后代目录 + `@` 引用源；行来自 subagent 会话 | `tool-subagent` 族禁 ⇒ 无后代可列 |
| ui-workflow-run | 已挂 | 消费 `tool-workflow/*` 四类 Session 事件重建 chat 节点 | `tool-workflow` 禁 ⇒ 无节点；**注**：daypaw 引擎的 durable run 不走 tool-workflow 事件，壳侧由 ui-inbox + `durable/journalTimeline` 呈现，此面与 fork run 面互不相干 |

⇒ 本簇的裁决变量只有一个：**要不要（部分/全部）启用工具套件**。启用了，五个面立刻活（挂载成本已付清）；不启用，它们是死重——甚至可以考虑裁掉行减负。UI 层无独立决策点。

## 3. 已挂且工作的面（业务语言化 / 双模式的候选）

- **ui-tool**：已挂且工作——SDK agent 的 `submit` 等调用经通用卡渲染；alpha.5 新增 `read_image` 结果渲染为图片卡（`a4d4404708`、嵌套路径修复 `56ca8af0ee`/`6e5ed52aed`），随 sync 白拿。verbatim 工具名/参数 = 开发者语言；业务语言化路径 = fork 在 `tool.call.toolview` 槽注册自有原子视图 + locale（README 明示该槽就是为此设计），**中等成本、面窄**（逐工具做）。
- **ui-trajectory**：已挂且工作——任意会话的 turn 感知事件账本 + 时序概览 + inspector（view ring 一个 tab）。README 自述「event content, tool names, identifiers, and provider diagnostics remain verbatim data」，其 `trajectory` locale 命名空间只管壳文案。业务语言化 = 高成本（事件本身是技术事实）；**「原样作为高级视图露出」是双模式 IA 的天然候选**（power 用户已付费的开发者面，业务用户不见）。
- **ui-approval / ui-user-questions / ui-deliverables / ui-message-feedback**：上游整包原样挂载（README：交互形态未变——composer 内单卡 / turn 尾产出行）。**记录一个与 #36 裁决的偏差**：map #35 裁「ui-user-questions/ui-deliverables 重写」，落地实为原样复用（roster 行 275/336 无 fork 覆盖）；#100 若翻定位，此两包是否真要业务语言化重写可一并再裁。
- **ui-permission（= ui-permission-presets）**：已挂、无 preset realm 时渲染为空——#46 裁不进 v1（固定保守默认），维持。
- **ui-agent-preset**：已挂但 yml 显式 `disabled: true`（行 325）——preset realm 未启；若定位重审触及「多预设组合/人设」会与此行相关（#46 人设不切的翻案面）。

## 4. 设置面残差

fork 单面页四分区（通用/凭据/模型/关于，`packages/daypaw/ui-settings/README.md`）；对照上游 settings-general 契约，被裁/休眠的上游能力：

- **连接失败指示器**（settings 座旁的恢复指示）——**已裁接入**（[#93](https://github.com/0xnicholas/daypaw-pro/issues/93)，业务语言移植），不再裁。
- **首跑 onboarding 分步引导**——fork 以首跑黄卡替代（#45 裁决 C 拼 A），有意替换。
- **本地配置文件动作**（local configuration-file action）——未入 fork 页；部署者向能力，业务用户无感，随定位裁决附带考虑。
- **feature 行 Permission/Language/Appearance 与 Models 之外的全部 `settings.section` 贡献**——fork 页对 `settings.section` 槽 `only: 'models'` 渲染（fork README 明载）⇒ **已挂但休眠**：ui-settings-plugin-inventory、ui-settings-plugins 两包挂了不显。部署者诊断三件（session-stats / session-log-download / plugin-inventory host）中前两者活跃于会话面，plugin-inventory 的设置节休眠。

## 5. 命令面 / 快捷键深度

ui-commands / ui-input-trigger / ui-skill 三包已挂：composer 的 slash 命令机制可用，但**命令的生产者与工具套件同域**（skill、workflow、goal、plan 皆为插件域命令），故命令面板的实际内容丰度同样受 §2 能力底座约束；`@` 引用源缺（§1 ui-reference 未挂）；layout 级快捷键随 fork 三栏布局由 fork 自持。

## 6. 补看漂移窗 `4e84901e64..49a606bc5b`（alpha.5）

对本清单唯一实质变化：ui-tool 图片卡三连（`a4d4404708`/`56ca8af0ee`/`6e5ed52aed`）——§3 的工具卡白赚项+1。其余为 release/merge 机械与无关域；面清单无增删。

## 7. 对裁决票的直接输入

- **「露什么面」的真轴不是 UI 挂载**（多数已挂或一行的事），而是：①**能力底座**——工具套件开不开、为谁开（#99 定位裁决的核心变量，#84 缺口③同根）；②**已工作面的语言化/分层**——工具卡业务原子视图（中成本窄面）与 trajectory 原样高级视图（双模式天然候选）。
- **真「面候选」短单**：ui-attachment（低依赖、近白赚）、ui-reference（中依赖、locale 就绪）、trajectory 高级视图（双模式）、工具卡原子视图（若启用工具）。
- **两处历史裁决与现实的偏差，建议 #100 顺带再裁**：#36「ui-user-questions/ui-deliverables 重写」vs 原样挂载现实；#46「敏感操作必审批」vs 工具全禁 ⇒ 审批面永空转（缺口的根因陈述）。

## 方法与边界

一手证据：roster 两文件全文 diff 与 yml 行号、上游 README 首段（`git show upstream/master:packages/client/<pkg>/README.md`）、git log 两窗。静态推断口径：**挂载=激活、disabled=关、README 明示生产者依赖=饿着**；未做浏览器逐面实测（每面渲染态按 README 契约推定）。ui-schedule 与 session-turn-outline 不再调查（已裁，指针 #85/#92）。fork 侧事实取自本 worktree（main @ `dd6fae8380`）。
