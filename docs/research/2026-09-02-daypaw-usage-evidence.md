# daypaw 使用证据盘点：今天实际被怎么用

> Wayfinder 研究票 [#96 「使用证据盘点：daypaw 今天实际被怎么用」](https://github.com/0xnicholas/daypaw-pro/issues/96) 的成果，隶属地图 [#95 「daypaw 产品定位重审：为谁、露什么面」](https://github.com/0xnicholas/daypaw-pro/issues/95)。日期：2026-09-02。调查对象：**本机运行时证据**（一手来源：`daypaw/ledger.db`、`~/.dsh/sessions/`、`daypaw/agents/`，均按绝对路径只读访问主 checkout；replica 账本在 `/private/tmp/daypaw-replica/`）。只记事实不裁定位；结论喂给 [#99 「定位裁决：产品为谁」](https://github.com/0xnicholas/daypaw-pro/issues/99)。

## 0. 一句话画像

daypaw 壳自落地（2026-08-24，#54–#61）以来共 **3 个 run、2 个工作区**，全部成功或滞留、零失败、零追问、零审批交互、零轻对话——使用形态是**发布/走查驱动的冒烟**，不是日常驾驶。定义名册从未生长（2 个 seed 文件原样），owner 的日常对话发生在 daypaw 之外（dsh CLI / 其他工作区）。

## 1. 引擎账本：3 个 run 的全量

### 1.1 主工作区 `daypaw/ledger.db`（daypaw-pro，2 run）

| run | 定义 | 状态 | 时间 | 输入形态 | 输出 |
|---|---|---|---|---|---|
| `c1371894` | note-lint 0.0.1（agent） | done | 2026-08-31 09:35 | 整篇 Agent Note 文档作 task（发布 tarball 闭环评审稿） | `verdict: needs-fixes` + findings |
| `ae512ad7` | note-lint 0.0.1（agent） | done | 2026-09-02 19:55 | `分析笔记`（map #77 功能走查冒烟） | `verdict: clean` |

（来源：`select … from runs` 全量 2 行；journal 每 run 5–7 step；`promises` 0 行。）

### 1.2 replica 工作区 `/private/tmp/daypaw-replica/daypaw/ledger.db`（1 run）

| run | 定义 | 状态 | 时间 | 输入 |
|---|---|---|---|---|
| `bad400ec` | starter-assistant（agent） | **running（滞留）** | 2026-08-31 10:52 | `帮我总结一下今天的天气` |

replica 是发布 tarball 冒烟环境（#69/#70 语境）；进程被杀后无人再启动，run 滞留 `running`——恰好实证 boot 扫描复活从未被触发过（没人回到那个工作区）。

### 1.3 账本维度的「从未使用」清单

- **rerun**：0（`attempt>1 or retried_from_run_id is not null` → 0 行）。
- **失败**：0；**等待/gate**：`promises` 0 行。
- **child run**：0（全部顶层）——subagent/workflow 编排面未被真实使用。
- **定义生长**：`daypaw/agents/` 恰好 2 个 seed 文件（`starter-assistant.mjs`、`note-lint.mjs`），无用户自建定义。starter 在主工作区**从未跑过**（唯一一次在 replica 冒烟）。

## 2. 会话孪生：两个 run 的对话形态

（来源：`~/.dsh/sessions/--Users-nicholasl-Documents-build-whatever-daypaw-pro--/`，zstd jsonl 事件计数。）

| 孪生会话 | 事件 | turn | steer 事件 | tool/call | approval |
|---|---|---|---|---|---|
| `ae512ad7`（走查） | 275 | 1 | **0** | 6 | `approval/policy` ×1（策略声明，**非交互**） |
| `c1371894`（评审） | 945 | 3 | **0** | 1 | `approval/policy` ×1（同上） |

- **追问（steer）从未发生**：两个孪生零 steer 事件——map #77 缺口①「运行中对话不可达」在数据侧的映照：入口打不开，自然无人追问。
- **审批交互从未触发**：仅 `approval/policy` 声明，无 `approval/asked/decided`——与 map #77 缺口③（seeded agents 无敏感操作面）互证。
- **轻对话零自然发生**：该工作区会话目录**只有两个孪生**（≡ run 数），不存在任何 run-less 会话——缺口②担心的「不经任务的聊天」在真实使用里一次也没发生（也无入口）。

## 3. 相邻证据：owner 的对话发生在 daypaw 之外

`~/.dsh/sessions/` 共 4 个工作区目录：

| 工作区 | 会话数 | 最后活动 | 性质 |
|---|---|---|---|
| `…daypaw-pro--` | 2（孪生） | 2026-09-02 | daypaw 壳的 run 孪生 |
| `--private-tmp-daypaw-replica--` | 1 | 2026-08-31 | 发布冒烟 |
| `…daypaw-agent--` | 4 | 2026-08-14 | **dsh CLI 普通会话**（壳落地前） |
| `…daypaw-website--` | 1 | 2026-08-14 | 同上 |

即：owner 在别的仓库用 dsh CLI 开过 5 个普通会话（2026-08-14，全部早于产品壳），而通过 daypaw 壳的普通会话为零。「轻对话需求」在 dsh 侧真实存在过、在 daypaw 侧从未有过入口验证。

## 4. 外部客户信号：仓库内为零，客户侧不可见

- issue tracker 全部 90 个 issue 的作者均为 `0xnicholas`（owner）——无外部用户提问/反馈。
- [ADR 0011](../../adr/0011-customer-self-run-delivery.md)（2026-08-22）的措辞是「**客户获取在即**、环境完全未知，按最坏情况设计」——立项时点是「预期」而非「已有」。
- 发布线活动（#62 直起壳、#68 恢复不动点、#69/#70 tarball 闭环 + 启动令牌、`dist-daypaw/` 产物目录）全部为交付准备动作，非客户驱动的事件。
- 画图锚点（map #95 Notes）称「已有外部客户在跑自含包」：本机证据**无法证实也无法证伪**（客户账本在客户机上）；客户画像与用量只能作为 [#99](https://github.com/0xnicholas/daypaw-pro/issues/99) 的 HITL 口述输入，本票不采信任何一方为定论。

## 5. 事实底册（喂定位裁决）

1. **量级**：壳落地 ~10 天，真实 run 共 3（2 冒烟 + 1 评审），日均 < 0.5——产品壳尚未成为任何人的日常工具。
2. **任务形态**：技术面 2/3（文档评审、走查冒烟），业务面措辞 1/3（天气总结，本身也是冒烟输入）——**没有任何一个真实业务用户的真实任务**入账。
3. **定义生态**：名册零生长，唯一被真实使用过的定义是 `note-lint`（技术用途）。
4. **未被使用的 v1 能力面**（数据侧）：rerun、审批待办、追问（steer）、多 turn 编排（child run）、waitFor gate——v1 四板块中最重的能力在真实使用中全部零命中。
5. **owner 的自然对话行为**在 daypaw 之外（dsh CLI、pi 会话、本 tracker 的 wayfinder 工作流）。

## 6. 方法与边界

- 引擎账本与会话目录均为**本机证据**：只覆盖 owner 自用；外部客户（若在跑）的账本不可见，其画像留给 #99 的口述输入。
- `approval/policy` 与 `approval/asked/decided` 的区分经事件类型核对（两个孪生各 1 条 policy、0 条交互）。
- `tool/call` 的工具名字段未解码（计数可信、名称未验）；不影响本票结论。
- 会话事件计数用 `zstd -dc` 流式统计，未落盘任何运行时数据；主 checkout 与 `~/.dsh` 全程只读。
