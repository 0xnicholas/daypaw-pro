# dsh-free spike：把 `@daypaw/engine` 接到一个裸 agent loop

> 日期：2026-09-26。假设与判定规则在开工前写死（[ADR 0019](../adr/0019-freeze-posture.md) 冻结姿态的后续验证）；本文只报测量结果，不含结论以外的推论。复现入口：`daypaw/spike/`（gitignored 工作区，见 §6）。

## 0. 假设与判定规则（先写死）

**假设**：把 `@daypaw/engine`（2,617 行，对上游文件零接触）接到一个非 dsh 的 agent loop 上，会让整个系统更简单。

| 测量 | 定义 | 通过线 |
|---|---|---|
| **M1** 适配层行数 | 把 engine 接到新 loop 所需的新增胶水（不含 engine 自身） | ≤ 600 |
| **M2** SIGKILL 复活 | 真 `kill -9` 中段杀死 + 新进程续跑到类型化完成 | 必须成立，不许退 |
| **M3** 语义覆盖 | 流式输出 / 工具调用 / 审批 gate / steering / cancel | ≥ 4 项 |
| **M4** 新概念数 | DI 容器 / loader 时序 / wire 协议 / 生成器与门阵 | ≤ 1 |

## 1. 环境

- Node v26.2.0 + tsx；模型走 DeepSeek 公共 API（`https://api.deepseek.com`，OpenAI 兼容 chat-completions，模型 `deepseek-flash`）。
- **零新依赖**：LLM 调用用 `fetch`；持久化用 `@daypaw/store` 的 `openLedgerDatabase` + `@daypaw/engine` 的 `SqliteJournalStore` / `DurableEngineCore`。
- 引擎核心确实 Cordis-free：`new DurableEngineCore(store, {instanceId, pollMs, logger})` 直接构造，全程没有启动 DI 容器、loader、RPC 面或任何生成器。`DurableEngineCore` 的构造签名见 `packages/daypaw/engine/src/core.ts:570`，boot 扫描见 `:749`。

## 2. 结果

| 测量 | 结果 | 证据 |
|---|---|---|
| **M1** | **90 行**（`daypaw/spike/durable.ts` 全体，含 boot 与 CLI 脚手架）；其中循环体 30 行 | `wc -l`；对照分母＝今日 dsh 绑定面 `packages/daypaw/sdk/src/agent.ts` 的 478 行 |
| **M2** | **成立** | §3 |
| **M3** | **4 / 5** | 工具调用 ✓、审批回调 ✓、模型调用 ✓、cancel ✓（`ctx.signal` 直连 `fetch`；未跑取消用例）、流式 ✗、steering ✗ |
| **M4** | **0** | 无 DI 容器、无 loader 时序、无 wire 协议、无生成器/门阵；引入的概念只有「消息数组 / 工具注册表 / 审批回调 / HTTP 调用」 |

其他规模数字：裸循环库 98 行（`loop.ts`，含 env 与 fetch 管道）、2 个工具 39 行（`tools.ts`）、D1 驱动器 22 行（`d1.ts`）。D1 一次真实任务（读文件 → 审批 → 写文件）3 轮 147 行跑通。

## 3. M2 证据（真 `kill -9`）

杀之前的进程日志（实例 `spike-55677`，`--delay 8000` 把崩溃窗口开在工具步内）：

```
[boot] registered; instance=spike-55677 mode=run
[step] model:1 → live call
[run] spike-run-1 status={"state":"running"}
[step] model:1 → 1 tool call(s)
[step] tool:1:call_00_ET_GWKjrSa2km65Ultj01TN3156 → read_file (live)
   ← kill -9
```

被杀后的 ledger（run 停在 running，一个步完成、一个步只有 started）：

```
runs:    [{"run_id":"spike-run-1","status":"running","claimed_by":"spike-55677"}]
journal: [{"step_key":"model:1#0",                                      "status":"completed"},
          {"step_key":"tool:1:call_00_ET_GWKjrSa2km65Ultj01TN3156#0",   "status":"started"}]
```

新进程 `--revive`（只注册定义，不持有任何调用者）的日志：

```
[boot] registered; instance=spike-55764 mode=revive
[step] model:1 → 1 tool call(s)          ← 无 "live call"：命中已记录结果，没有重发模型请求
[step] tool:1:call_00_ET_GWKjrSa2km65Ultj01TN3156 → read_file (live)   ← 未完成步重执行
[step] model:2 → live call
[step] tool:2:call_00_NypbfuwThQrRHaZx3fcy4018 → write_file (live)
[approval] write_file {"path":"summary.txt", ...} → auto-approve
[step] model:3 → live call
[step] model:3 → 0 tool call(s)
[revive] no run left driving
```

终态（run `done`，五个步全 `completed`，`summary.txt` 内容为该任务要求的输出）：

```
runs:    [{"run_id":"spike-run-1","status":"done"}]
journal: model:1#0 completed · tool:1:… completed · model:2#0 completed · tool:2:… completed · model:3#0 completed
```

跨进程接管走的是条件更新 claim（`UPDATE runs SET claimed_by … WHERE claimed_by IS NULL OR claimed_by <> ?`），所以死进程持有的认领权自动失效。

## 4. spike 没有做什么（测量边界）

- **无 session 持久化**：对话历史只活在 ledger 的 step 记录里，不产生 dsh 意义上的 session log；模型可见性靠重放重建。
- **无沙箱**：文件工具直接读写工作目录，没有路径约束、权限模型或逃逸防护（dsh 的 `packages/sandbox/**` 面不在）。
- **无工具面**：只有 2 个工具；dsh 交付的 24 个工具包（bash / pwsh / terminal / fs / lsp / web / subagent / skill / todo / MCP / workflow…）一个都没有。
- **无流式、无 MCP、无 subagent、无模型适配层、无 prompt 组装、无成本核算**。
- **审批是 console 回调**：没有审批 UI、没有审计投影、没有 durable 审批待办。
- **未测**：并发多 run、多进程 claim 竞争、spawn 子 run、gate 的跨进程 settle、durable timer。
- **D3 对照（Claude Agent SDK）未执行**：环境无该 SDK 的凭据配置，按计划本应做半天 sanity check，本轮跳过。

## 5. 判定

按开工前写死的规则：**M1 90 ≤ 600 ✓、M2 成立 ✓、M4 0 ≤ 1 ✓ → 离开 dsh 成立**。

结论的边界必须写清：**spike 只证明引擎那半可以活在 dsh 之外，不证明产品壳那半可以。** 壳的 5.6k 行 `ui-*`（任务板 / 收件箱 / 设置 / agent 目录 / 品牌主题）全部建立在 dsh 的客户端插件系统上（slot 环、locale、renderer、primitives、remote wire），`packages/daypaw/ui-inbox` 一个包就 import 15 个 `@deepseek-ai/*` 包。spike 对那一半一句结论也没有。

因此真正的分岔不是「引擎要不要离开 dsh」，而是**壳怎么办**——该分岔已由 [ADR 0020](../adr/0020-shell-stays-on-dsh.md) 裁决：壳留在 dsh，换轴只在写死的触发条件命中时复议。三条路的相对分量如下，供复议时取用：

1. **壳留在 dsh 上，引擎走出去**：引擎作为独立库 + 自己的宿主（本次 spike 的形态），壳继续用 dsh 的浏览器面。代价是两套世界并存，产物形态分裂。
2. **壳一起重写**：按 M1 的实测比例（引擎侧 90 行 vs 今日 478 行绑定），壳侧的重写量是 5.6k 行 src + 9k 行测试，且要自己补 slot 环 / locale / primitives / 主题 / remote wire。
3. **都不动，冻结就够了**：ADR 0019 已按此执行；spike 的结论不构成换轴的理由，只是把「引擎可以离开」从假设变成事实。

## 6. 证据留存

spike 是一文性工作区：四个文件（`loop.ts` / `tools.ts` / `d1.ts` / `durable.ts`，249 行）当时住在 gitignored 的 `daypaw/spike/`。跑完即删，不进版本控制——它的结论已落在本文 M1–M4 与 [ADR 0020 §1](../adr/0020-shell-stays-on-dsh.md)，而它的选项现在处于停车位（ADR 0020 §2 的触发条件）；为一个停着的选项保留一份无门看护、必然腐烂的副本不值当。

复现按本文 §0 的四项测量与 §1 的环境重写一次即可（一日量）；下面是与当时目录结构对应的原始命令，供重写时对照：

```sh
node --import tsx daypaw/spike/d1.ts                                  # D1：裸循环
rm -f daypaw/spike/sandbox/spike-ledger.db* daypaw/spike/sandbox/summary.txt
node --import tsx daypaw/spike/durable.ts --delay 8000 &              # D2b：开崩溃窗口
# 等 [step] tool:1 出现后 kill -9
node --import tsx daypaw/spike/durable.ts --revive                    # D2b：boot 扫描续跑
```

```sh
node --import tsx daypaw/spike/d1.ts                                  # D1：裸循环
rm -f daypaw/spike/sandbox/spike-ledger.db* daypaw/spike/sandbox/summary.txt
node --import tsx daypaw/spike/durable.ts --delay 8000 &              # D2b：开崩溃窗口
# 等 [step] tool:1 出现后 kill -9
node --import tsx daypaw/spike/durable.ts --revive                    # D2b：boot 扫描续跑
```
