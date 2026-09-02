# 上游漂移盘点：checkpoint 后 client 栈与 web 托管面

> Wayfinder 研究票 [#78 「上游漂移盘点：checkpoint 后 client 栈与 web 托管面的变化」](https://github.com/0xnicholas/daypaw-pro/issues/78) 的成果，隶属地图 [#77 「daypaw 前端架构复盘：复用边界与路线 B 评估」](https://github.com/0xnicholas/daypaw-pro/issues/77)。日期：2026-09-02。漂移窗：`cd5ef81481`（= `daypaw-sync/2026-08-28`，release 0.1.2-alpha.1）→ `4e84901e64`（upstream/master，2026-09-01，release 0.1.2-alpha.4），共 **648 提交 / 4 天**，其中触及 `packages/client/**` 的 171 条。一手来源：`upstream` remote 的 git 对象（提交 sha 一律内联）；底册为 [research/client-reuse-inventory 分支上的 2026-08-23 复用清单](https://github.com/0xnicholas/daypaw-pro/tree/research/client-reuse-inventory)（#37 成果，未合入 main）。结论喂给 [#80 「复用边界再裁决」](https://github.com/0xnicholas/daypaw-pro/issues/80)。

## 0. 先校准：底册名字早于一次上游重组

#37 清单（2026-08-23，当时 fork main @ `2be4cffa14`）描述的是 `runtime` / `web-react` / `render-service` 时代的布局；**2026-08-28 sync 本身就载入了上游的一次大重组**（`daypaw-sync/2026-08-18` = `a0a2a87370` → `cd5ef81481` 窗内的 rename 证据）：

- `packages/client/runtime`（React-free 对象层）拆散为 `store`（store 契约，`runtime/src/client/contract/store.ts → store/src/index.ts`）、`ui-conversation`（会话域层：registries/assembler/contract）、`ui-chat`（chat 模型层：partial 节点、steering history、tool-call-tree）。
- `packages/client/render-service` → `ui-renderer`（`runtime/src/client/slots.ts → ui-renderer/src/client/registry.ts` 一并并入）。
- 旧 `ui-conversation` 的聊天**表现**整体搬进新 `ui-chat`，`ui-conversation` 让位给域层。

因此「13 整包复用」在今日树上应读作：connection、locale、modules、web、ui-slots、ui-settings、ui-theme、ui-primitives、ui-attachment、hmr（未动）+ `runtime` 名义下的 store / ui-conversation / ui-chat / ui-renderer 四包。壳板块 #54–#61（2026-08-24 起）在这场重组**前后**落地，fork 侧适配随 2026-08-28 merge（`c7fb63484f`）带入；今日 `@daypaw/ui-*` 实际依赖的是新名（`@deepseek-ai/dsh-client-store` / `ui-chat` / `ui-conversation` / `ui-session` 等，见各 `packages/daypaw/ui-*/package.json`）。**再裁决票应直接采用现行包名，不再用底册旧名。**

## 1. 全景：漂移体量与分布

| 区域 | 提交数 | 一句话 |
|---|---|---|
| `packages/client/**` | 171 | 三条横切重构 + ui-chat/ui-conversation 性能浪潮 + 全局视觉深化；包清单仅 +`ui-schedule` |
| `packages/api/**`（gateway/session-controller 等 BFF 面） | 56 | Remote 失败词汇收敛 + 会话 seq/log-offset 重构主战场 |
| `packages/typert/**` | 13 | 随 Remote 收敛的小幅涟漪 |
| `packages/session/**` | 215 文件改动 | seq/offset 重构 + session-log-read-api（#2907）+ 新增 `session-turn-outline` 子包 |
| `packages/host/webserver`、`host/frontend-static` | 各 6 | 仅 release bump + invariant 清扫——**托管面安静** |
| `packages/bundle/web-app` | 15 | invariant 清扫 + roster 增两行（§4） |

上游节奏：4 天三个 alpha release（`14bab4422b` alpha.3、`a9e185f205` alpha.4），client 栈处于高频演化期。

## 2. 三条横切重构 + 一场清扫（下次 sync 的主重放成本）

这四条都不是单包演进，而是改协议/改约定的面重构，全部命中 fork 的 core touch 或 fork 自营代码：

1. **`27bf1039db` `refactor(session)!: distinguish event seqs from log offsets`**（351 文件，+5913/−2838，含 `packages/client/connection/src/client/fixture.ts`、`packages/api/session-controller/**` 大改，配套 `5dd876025d` merge #2907 session-log-read-api）。会话事件序号与日志偏移分离——SessionEventMap 成员名未变（`packages/session/src/events.ts` 无 seq/offset 行差异），但**日志读取 API 与投影基线重排**（另见 `dd3e1c8490` `fix(session): replay projection baselines in order`）。fork 影响面：golden 车道所骑的 fixture.ts core touch、`@daypaw/ui-inbox` 的 task-projection、上游快照语料整体刷新（上游自己已带着改，fork merge 免费获得，但 fork 自营 golden 的期望值要跟着重录）。
2. **`804b1ffbfc` `refactor(api): converge the Remote failure vocabulary and client surface`**（252 文件，+3181/−3831）。gateway 侧新增 `packages/api/gateway/src/remote-error-codes.ts`，`TypertGatewayError` 改继承 `RemoteError<TypertGatewayErrorCode>`，错误码收敛为 `gateway/*` 命名空间（如 `invocation-unavailable → gateway/invocation-unavailable`）；配套 `2b750cfb51` 为收敛后的 `ctx.remote` 编程面立文档。fork 影响面：**`durable/*` 系 fork 私有 Remote（engine `core.ts`、sdk `wire.ts`、ui-agents/ui-inbox 的消费端）须采纳同一失败词汇**，fixture 应答与错误路径断言随之改。
3. **`9135a13a8b` `refactor(consumers): remove cross-package runtime relays`**（167 文件）。跨包 runtime relay 出口面删除，各 client 包 `src/index.ts` 出口收缩（locale/ui-chat/ui-conversation/ui-deliverables/ui-settings-general 等）。fork 影响面：`@daypaw/ui-*` 若转出口了上游 relay 符号需同步收缩；fixture.ts 亦有小改（+7/−2）。
4. **`15f2997bcb` `cleanup: omit unneeded invariant companions`**（单提交触 259 个 invariant 相关文件）。`packages/client/*` 的 `src/invariant.ts` 成批删除（connection、locale、store、ui-agent-preset、ui-approval、ui-attachment、ui-brand-official、ui-chat 等全数在列）。fork 影响面：无文件级冲突（`packages/daypaw/*/src/invariant.ts` 是 fork 自营），但**约定漂移**——上游已把「无谓 invariant 伴生物」判为反模式，fork 的 `@daypaw/*/invariant` tsconfig 映射与各包伴生物是否保留，应在再裁决时对齐一次口径。

## 3. 复用面逐族判定（对 map #35 边界的影响）

判定词：**升值**（白拿的改进）/ **贬值**（边界前提被削弱）/ **中性** / **替代物**（上游长出我们自建面的等价物）。逐族：

| 现行包/族 | 漂移事实（sha） | 判定 |
|---|---|---|
| `connection`（14 提交） | 恢复能力硬化浪潮：`ccfbbb443a` 集中 websocket 恢复（client/index.ts +73 行，新增 `ConnectionStateSource`/`ConnectionLoop` 出口）、`49bf26a794` 容忍僵死宿主、`18480ff902` 恢复行为测试建档；另骑三条横切重构涟漪 | **升值**：消费端 `call` API 仅加性变化，内核韧性白拿。但 fixture.ts core touch 须在三条横切重构上重放（§2） |
| `store`（7） | 仅 invariant 清扫 | 中性 |
| `ui-chat`（63）/ `ui-conversation`（47） | 流式性能浪潮：`c809098b06`/`5934201109` 每 2–3 帧发布流式更新、`0e90d47d19` 跳过稳定节点列表映射、`577f0cf7d9` renderer 绑定 keyed chat sources、`81431381d6` 复用未变 location 投影、`ebe9f50b44`/`203e2440ac` 布局收进 CSS；会话域层（registries/assembler）结构稳定 | **升值**：`@daypaw/ui-tasks` 消费的模型层整体提速，白拿；fork 自绘的业务语言对话流后续可借同款手法 |
| `web` / `ui-theme` / `ui-layout` / `ui-sidebar` 及全部 `ui-*` 表现包 | 全局视觉深化：`7020c7e122` superellipse 圆角 + 0.5px 发丝描边 + 逐元素 elevation token（ui-theme 新增 `styles/corner-shape.css`、`gradient-shadow-text.css` 与 **repo 级 stylesheet-scan 规则**）、`3ce5604a71` composer 描边加深 l2、菜单圆角 20px | **中性偏摩擦**：`ui-theme/src/theme.ts` token 值零改动，`@daypaw/ui-brand` 的 override 集不失效；但 `ui-theme/tests/stylesheet-scan.ts` 遍历 `packages/`（含 `packages/daypaw`），其规则（未配对圆形、border+shadow 混用、1px 中性发丝线全仓拒绝）下次 sync 将**直接扫描 fork CSS**——品牌层与 `--dp-space-*` 密度样式可能触规 |
| `ui-model-selection`（10） | 视觉涟漪 + 错误词汇收敛；配套 `5257c75092`（llm 复用 profile headers 做模型发现）改善供数质量 | 中性偏升 |
| 命令面三包 `ui-commands`/`ui-input-trigger`/`ui-skill` | `ff21366916` Tab 补全高亮命令、`6daed7c5aa` trigger 菜单 Enter 在 refinement 悬置期显式 no-op、`d5a9e5b274` 下钻前先发布 claim | **升值**：纯修缺陷，零 API 变化 |
| `ui-session`（7）/ `modules`（4）/ `hmr`（4）/ `ui-slots`（8）/ `locale`（12）/ `ui-settings`（11） | 横切重构涟漪（relay 收缩、错误词汇、invariant 清扫）+ `577f0cf7d9` keyed sources 挪进 renderer | 中性：机械面稳定，重构随 merge 自动带上 |
| 重写簇上游侧（`ui-conversation` 表现已并入 `ui-chat`；`ui-tool` 21、`ui-trajectory` 17、`ui-workflow-run` 10、`ui-subagent` 10、`ui-goal` 11、`ui-plan` 9 等） | 性能与视觉涟漪为主（`2ab37e9558` trajectory 常驻历史分页、`4203317e18` 按需物化 conversation targets）；无概念转向 | 中性：重写裁决的前提（开发者信息密度）未被动摇 |
| `ui-user-questions`（10）/ `ui-deliverables`（17） | 性能涟漪（`e5bbee893b` overflow 尺寸挪 CSS、`c11c3f98ad` 记录 CSS overflow 政策）；交互形态未变（composer 内单卡 / turn 尾产出行） | 中性：#36 重写裁决维持的理由未变 |
| `ui-jobs`（9） | 仅视觉涟漪 | 中性：仍是 session 进程内 jobs，未向 durable run 演化 |
| `ui-approval`（8） | 仅视觉涟漪（composer 内即时卡形态不变） | 中性：fork 的收件箱式审批中心（#58）无上游替代物 |
| 托管面 `host/webserver`、`host/frontend-static`、`bundle/web-app` | 各 6/6/15 提交，皆 release bump + invariant 清扫 + relay 收缩；`web-app/cordis.patch.yml` 增两行 roster（§4） | **安静**：路线 B 的 dist 托管前提稳固 |

**横切结论：漂移没有出现任何一处「上游长出我们自建面的替代物」。** 收件箱任务中心（durable/listRuns + 轮询投影）、审批待办中心、agents 目录（Typert Remote 只读视图）、壳发起 run（startRun + 弹窗）仍是 fork 独有面；上游同域包（ui-jobs、ui-approval、ui-agent-preset）形态未变。复用内核（connection/store/web/ui-chat 模型层）在原位升值。**成本不在于贬值，而在于重放：fixture.ts、durable/* 失败词汇、repo 级 stylesheet-scan 三项集中了几乎全部 sync 摩擦。**

## 4. 上游新能力（我们未接的面）

1. **`packages/schedule` + `client/ui-schedule`（21 提交）**：session 内本地提醒——绝对时间/固定间隔、「到点以普通消息回到同一会话」、重启存活但**明确不出会话**（README：no email/SMS/push）。与 map #35 雾区「通知（站外触达）」不重叠，也不是 durable run 调度。web roster 行已加但 `disabled: true`（Schedule overlay 显式开启）。对产品壳是**新灰色裁决**：业务用户的「稍后提醒我」与任务定时是否要接。
2. **`packages/session/session-turn-outline`（`7e2eacb1fe`）**：全日志 turn outline 投影（`turnOutline` projection key），每个 turn 在其事件分页载入前即可导航；web roster 默认启用。session 域能力，与 fork 的 `durable/journalTimeline` 右栏时间线**互补不替代**；长会话导航对业务用户亦有价值，接不接是产品决策。
3. **steer 服务（PR #3250，merge `52af48f808`；187 文件，净 −1857 行）**：相邻 agent 消息投递统一到 steer（`ec493c2db8`、`b91e7ce366`），缝落在 `packages/api/session-controller`（`control.ts` 等）与 `packages/core/agent-loop`。这是**会话级** steer（在飞会话的插话/追图，`7c38fd8102`/`53f5418a72` 修投递），不是引擎级 durable steer——fork #74 的 `durable/steer|cancel` Remote 无替代；但它可能是将来「壳发起 run 的会话孪生」插话的顺路消费面。
4. **连接恢复指示器（`19b4d7f26c` + `84c7ae3398`）**：上游在 settings-general 壳加了断线恢复指示。fork 重画的设置单面页（#59）没有等价物——**补齐候选**，尤其 connection 恢复硬化（§3 第 1 行）之后，「正在重连」的业务语言呈现有真实价值。
5. **roster 净增两行**（`bundle/web-app/cordis.patch.yml`：`session-turn-outline` 启用、`ui-schedule` 禁用）+ `0cdcc9c3c5` PTC preset 剔除 workflow 插件。fork 的 `@daypaw/web-app` roster 镜像层下次 sync 要对这两行各做一次收/不收裁决。

## 5. 对再裁决票（#80）的直接输入

- **边界方向仍然成立**：零替代物 + 复用内核原位升值，路线 B 的复用面没有被上游演化侵蚀。
- **重放成本再定价**：CORE_TOUCHES 里前端可归因条目的重放成本，大头从「条目自身」移到「三条横切重构 × fixture.ts」与「repo 级 stylesheet-scan × fork CSS」两个交叉点；ui-theme `DEFAULT_PREFERENCE` 条目本身零漂移（`theme-settings.ts` 无提交）。
- **词汇升级**：裁决记录应迁移到现行包名（store/ui-conversation/ui-chat/ui-renderer），并在 CORE_TOUCHES 与 spec 05 §4 之间对齐一次名字。
- **新裁决点入库**：ui-schedule、session-turn-outline、连接恢复指示器三个接/不接问题；`@daypaw/*/invariant` 伴生物口径是否跟上游清扫对齐。

## 6. 方法与边界

- 一手证据全部来自 `upstream` remote git 对象（`git log/diff/ls-tree/grep cd5ef81481..upstream/master`），sha 内联可复核；`packages/schedule` 判读取其 README 首段契约。上游默认分支是 **master**（无 main）。
- 底册 #37 未合入 main，取自 `origin/research/client-reuse-inventory` 分支；其包名映射经 `daypaw-sync/2026-08-18..cd5ef81481` 窗的 rename 清单核实（§0）。
- 提交主题清单已滤除 release bump、merge、manifest 机械提交；逐包判定基于提交主题 + 关键 diff 抽读（connection 出口面、gateway 错误面、ui-theme 扫描器、roster 行），未逐行审读全部 648 提交。
- fork 侧事实（依赖清单、roster、core touch 归属）取自本 worktree 树（HEAD @ `dd6fae8380`）。
