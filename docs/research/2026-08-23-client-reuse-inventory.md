# 上游 client 栈复用清单（逐包三分类）

> Wayfinder 研究票 [#37 「上游 client 栈复用清单盘点」](https://github.com/0xnicholas/daypaw-pro/issues/37) 的成果，隶属地图 [#35 「daypaw 产品壳前端：设计 spec 与路线」](https://github.com/0xnicholas/daypaw-pro/issues/35)。日期：2026-08-23。调查对象：**本仓库当前树**（main @ `2be4cffa14`）。本地地形研究：一手来源为各包 README 与 `packages/client/AGENTS.md`，引用一律为仓库内路径。结论喂给「技术路线锁定」票的复用边界裁决。

## 0. 裁决依据

三条一手依据，先于逐包判断：

1. **分层红线自带答案的一半**。[packages/client/AGENTS.md](../../packages/client/AGENTS.md) 的三层划分把「可复用性」写成了架构事实：数据对象层（`runtime`，React-free）与渲染机械（`web-react`）是承载层；表现组件（各插件包的 `src/client/`）是 **consumables, expected to be rewritten wholesale**——上游自己就把表现层定位为一次性消耗品。复用问题因此收敛为：对象层/协议层/纯组件整包拿走，表现层重写，剩下的逐个裁决。
2. **产品壳的需求面**（map #35）：agent 对话、任务/run 进度（业务语言）、审批待办、agent 目录与设置；用户 = 非技术业务人员；路线候选 B 已假定「复用 `client/connection` + `client/runtime`，fork 自有 profile 托管自有 dist」。
3. **web 壳零组合决策**。[packages/client/web/README.md](../../packages/client/web/README.md)：roster 与 immediately 层完全由宿主 graph 组成，shell 不做任何组合决策——换掉全部 `ui-*` 表现插件不需要动 shell 内核，只需换一张 cordis 组合图。这使「整包复用内核 + 重写表现」成为低摩擦路径。

分类口径：**复用** = 整包作为依赖直接进产品壳组合（协议/对象层/纯组件，无用户可见开发者术语）；**重写** = 概念或交互假设与业务用户不兼容，产品壳需要同名能力但实现重来（或不随壳交付）；**灰色** = 包本身质量可用，但去留系于 map #35 尚未裁决的产品问题，需逐包裁决记录。

## 1. 复用（13 包）：整包依赖直接拿走

| 包 | 一行理由 |
|---|---|
| [connection](../../packages/client/connection/README.md) | 纯 wire 消费层（/api RPC + 双 WS 下行 + 信任栅栏），零用户可见文案；路线 B 的既定前提。 |
| [runtime](../../packages/client/runtime/README.md) | React-free 对象层：Session/Workspace 对象、事件窗、流式累积、projection、ConversationNode 装配机全部在此——重写表现层后仍由它供数；术语「Session/Workspace」不出现在 UI 文案义务里。 |
| [modules](../../packages/client/modules/README.md) | 客户端模块系统（浏览器懒 CJS 表 + Node 插件表），内核机械，与产品定位无关。 |
| [web](../../packages/client/web/README.md) | 两段式 boot 内核，零组合决策、不 value-import 任何插件包；路线 B 的托管入口本身就是它。 |
| [web-react](../../packages/client/web-react/README.md) | ctx↔React 粘合（SlotRenderer、SessionProvider、hook 绑定），业务包本就不依赖它，纯壳内机械。 |
| [ui-slots](../../packages/client/ui-slots/README.md) | slot 注册纯核心，React-free、cordis-free；任何表现层重写都在它之上组合。 |
| [locale](../../packages/client/locale/README.md) | locale 偏好 + ns×locale 词典注册机制；词典内容本就由各 owner 包自带，机制与术语无关。 |
| [schema-form](../../packages/client/schema-form/README.md) | settings 编辑器的 schema/draft 模型层，无 React 无渲染；产品壳设置面的草稿语义直接受用。 |
| [ui-settings](../../packages/client/ui-settings/README.md) | settings 域基座：`ctx.settingsScope` 传输 + slot 类型声明，**无任何自身表现**；产品壳的设置扩展点即它。 |
| [ui-theme](../../packages/client/ui-theme/README.md) | `--dsw-*` token 基座 + 主题偏好服务；品牌换肤 = 换 token 值，机制产品无关。 |
| [ui-primitives](../../packages/client/ui-primitives/README.md) | 零 cordis 纯原子（按钮/菜单/Toast/MarkdownText 含安全策略与流式增量解析）；直接当组件库依赖，dev 向块（TerminalBlock/DiffBlock 等）不用即不渲染。 |
| [ui-attachment](../../packages/client/ui-attachment/README.md) | 零 cordis 附件原子（图片轨/画廊/lightbox/拖放遮罩），文案全走 label props，业务中性。 |
| [hmr](../../packages/client/hmr/README.md) | 开发期热重载；生产 graph 本就不含此行，复用成本为零。 |

## 2. 重写（15 包）：开发者向定位，概念或交互假设不兼容

| 包 | 一行理由 |
|---|---|
| [ui-conversation](../../packages/client/ui-conversation/README.md) | 对话表现本体：step 摘要流、tool 行、command 行、queue/todo dock 全是开发者信息密度；按红线本就该 wholesale 重写，业务语言版对话从 runtime 的 ConversationNode 供数重新画。 |
| [ui-tool](../../packages/client/ui-tool/README.md) | 工具调用树 + 逐工具细节视图，是「任务进度」的开发者形态；产品壳的 run 进度用业务语言呈现，不暴露 tool call。 |
| [ui-workflow-run](../../packages/client/ui-workflow-run/README.md) | 消费 `tool-workflow/*` 事件（模型写脚本的 workflow），与 daypaw durable run（engine ledger）不同源；其「durable run 可回放投影」模式可作参照，实现重来。 |
| [ui-trajectory](../../packages/client/ui-trajectory/README.md) | turn 级事件台账 + token/TTFT 检视，纯观测面——map #35 已把支柱③运营观测划出壳外；不随壳交付。 |
| [ui-sidebar](../../packages/client/ui-sidebar/README.md) | 品牌 wordmark + 导航 IA 即产品定义，必随信息架构草图重来；包本身极薄，无可复用机械。 |
| [ui-workspace](../../packages/client/ui-workspace/README.md) | Workspace = cwd 分组，纯开发者心智模型；业务壳按任务/agent 组织，不按文件系统目录。 |
| [ui-directory-picker-browse](../../packages/client/ui-directory-picker-browse/README.md) | 文件系统目录浏览对话，业务用户无此操作面。 |
| [ui-directory-picker-native](../../packages/client/ui-directory-picker-native/README.md) | 同上，OS 原生目录选择器的驱动壳。 |
| [ui-subagent](../../packages/client/ui-subagent/README.md) | subagent 目录树 + token/耗时列是开发者词汇；产品壳的「agent 目录」指 agent 定义目录（defineAgent 注册表），不是 session 子女。 |
| [ui-goal](../../packages/client/ui-goal/README.md) | `/goal` 是 dsh 开发者概念；产品壳的任务意图走 defineAgent 输入与 run，不走 goal 条。 |
| [ui-plan](../../packages/client/ui-plan/README.md) | plan-mode 芯片挂在 `/plan` 命令交互上；审批在产品壳是待办中心，不是斜杠命令驱动的模式开关。 |
| [ui-agent-preset](../../packages/client/ui-agent-preset/README.md) | preset = cordis 组合（插件名单），纯部署者概念；它是「agent 目录」的最近似现有物，但产品壳目录围绕 agent 定义重写。 |
| [ui-settings-models](../../packages/client/ui-settings-models/README.md) | provider/credential 配置面向部署者；`@daypaw/cli` 自含交付下运营者画像与凭据预置策略都不同，重写为运营者设置。 |
| [ui-settings-plugins](../../packages/client/ui-settings-plugins/README.md) | 暴露 bash executor、agent-loop 并行度等旋钮，业务用户永不该见；不随壳交付。 |
| [ui-settings-plugin-inventory](../../packages/client/ui-settings-plugin-inventory/README.md) | Cordis Loader 清单只读页，纯开发者诊断面；不随壳交付。 |

## 3. 灰色地带（11 包）：需裁决，逐包注明裁决点

| 包 | 现状 | 裁决点（挂在哪个未决问题） |
|---|---|---|
| [ui-layout](../../packages/client/ui-layout/README.md) | 三栏 AppFrame + `ctx.layout` 几何服务 + 主题 presenter；窄视口链在上游本身未走完验收。 | 产品 IA 是否保留「导航/对话/详情」三栏；#35 移动端/响应式要求未裁决。若 IA 同构则整包可用。 |
| [ui-commands](../../packages/client/ui-commands/README.md) | `/` 命令目录缓存 + 三种 dispatch；斜杠交互是开发者假设，但 session Keyed 目录缓存与 `command/executed` 回声是干净机械。 | 业务壳是否保留任何命令面（如「+」菜单代替 `/`）；与 ui-input-trigger 同一次裁决。 |
| [ui-input-trigger](../../packages/client/ui-input-trigger/README.md) | 触发管道 `src/core/` 是纯核（零 React/DOM/cordis），菜单 UX 与 `/`、`@` 词汇是开发者向。 | 业务壳是否有 `@` 引用（提及 agent/文件）；若有，纯核复用、菜单重画。 |
| [ui-skill](../../packages/client/ui-skill/README.md) | `/`-触发的 skill 调用源，极薄（一次源注册）。 | daypaw agent 是否向业务用户暴露 skill 调用；默认倾向不带。 |
| [ui-user-questions](../../packages/client/ui-user-questions/README.md) | 结构化问答 + plan-review 审批卡，是壳「审批待办」核心的最近似现有物；交互假设是 composer 内单卡逐个问。 | 审批是留在对话内即时卡，还是跨任务待办收件箱（或两者）；HITL 决策票裁决。 |
| [ui-jobs](../../packages/client/ui-jobs/README.md) | 会话头 jobs 弹层，文案意外地业务中性（label/状态/时长），但数据是 dsh 进程内 jobs，≠ durable run。 | run 进度视图的词汇映射：壳只认 run（CONTEXT.md「ledger/Manager/EVO 只认 run」）；若 session 级后台活动也要露，此包近可用。 |
| [ui-deliverables](../../packages/client/ui-deliverables/README.md) | turn 尾产出文件行 + 内联文件引用链接——概念正中业务用户（「做出来的是什么」），但识别依据是 mutation 工具的 render intent（diff/edit 词汇）。 | 产出物面绑定 daypaw run 的 output schema 还是上游工具 render intent；与 deliverable-artifacts 研究（[#32](https://github.com/0xnicholas/daypaw-pro/issues/32)）合读。 |
| [ui-message-feedback](../../packages/client/ui-message-feedback/README.md) | 赞/踩 + 备注，UX 业务中性，宿主侧已接关联层（messageFeedback Remote）。 | 产品壳 v1 是否要反馈面（EVO 远期，但关联层采集可先跑）；去留裁决而非重写裁决。 |
| [ui-settings-general](../../packages/client/ui-settings-general/README.md) | settings 壳 + onboarding ledger 机械（一次挂一步、registrant 自拥完成态）对产品首跑很有价值；chrome 与 General 段内容 dev 向。 | 设置 IA 与首跑流程设计定后：ledger 机械值得留，壳体重画。 |
| [ui-permission-presets](../../packages/client/ui-permission-presets/README.md) | 权限预设（Full access 风险确认）是开发者安全模型。 | #35 明示「多用户与权限模型未裁决」；裁决前此包悬空。 |
| [ui-model-selection](../../packages/client/ui-model-selection/README.md) | provider 分组/effort/路由是开发者词汇；业务用户大概率从不选模型。 | 运营者 vs 终端用户的人设切分：模型选择是否只进运营者设置。 |

## 4. 对路线锁定的含义

- **复用面恰好是路线 B 的假定面**：13 个复用包 = connection/runtime 对象层 + web/modules/web-react/ui-slots 内核 + locale/schema-form/ui-settings 服务基座 + theme/primitives/attachment 纯表现基料。路线 B（fork 自有 profile 托管自有 dist）因此不背上任何开发者向表现包袱——组合图换掉 §2 的 15 包即可，shell 内核零改动（§0 依据 3）。
- **重写面集中在会话表现域**：ui-conversation/ui-tool 及其卫星（ui-workflow-run/ui-subagent/ui-goal/ui-plan）构成一个重写簇，共用同一供数层（runtime 的 ConversationNode 装配机与 projection 面留在复用侧），重写的只是渲染与文案。这符合红线「表现组件是消耗品」的预设，工程量集中在信息架构与组件，而非数据管道。
- **灰色包的共同特征是「去留系于产品决策，不系于代码质量」**：11 包里只有 ui-layout、ui-commands/ui-input-trigger、ui-settings-general 涉及真实的机械复用取舍，其余是去留裁决。建议技术路线锁定票把灰色 11 包逐个转成一行裁决记录，而不是留作隐含默认。
- **范围注**：`packages/test-support/client-runtime`（test-runtime）在 `packages/client/` 树外，未计入本清单；产品壳若沿用上游 GUI 测试三层结构（`packages/client/AGENTS.md` 测试节），它随之复用。

## 5. 方法与边界

逐包依据为各包 README 首段契约与 Known Limitations，未逐行核源码；README 是本仓库的包契约层（docs/AGENTS.md 分层表），作为复用裁决的一手来源足够。`packages/client/README.md` 的包清单表落后于实际目录（缺 ui-deliverables、ui-directory-picker-*、ui-message-feedback），本清单以目录实物为准（39 包：8 基础设施 + 31 个 `ui-*`）。
