# Agent 观测/管理技术地形（ticket #4 research brief）

> 为「Manager 范围与控制面」票提供的决策输入。调研日期：2026-08-16。
> 结论先行：**dsh 的 canonical session log 已经是事实源；缺的是 (1) 一层可导出的 OTel trace 投影，(2) 一个本地轻量关联库（eval/feedback/dataset→session.seq 指针），(3) 一个 Temporal Web UI 式的管理面。不建议整体引入 Langfuse/Phoenix 的数据模型。**

---

## 0. dsh 现状侧（本地代码事实）

| 已有 | 事实 | 来源 |
|---|---|---|
| `session-telemetry` seam | `SessionTelemetrySink`（emit/flush/shutdown）契约 + `sessionTelemetry/record` redact waterfall + handoff cursor（at-most-once，接收端按 `(session.id, event.seq)` 去重） | [seam README](file:///Users/nicholasl/Documents/build-whatever/deepseek-harness/packages/session/session-telemetry/README.md) |
| `session-telemetry-otel` 后端 | **OTLP/HTTP logs**（不是 traces）；FULL / FEEDBACK_ONLY / DISABLED 三模式；fork 谱系靠 `session.parent_id` + `session.seed_length` 缝合 | [otel README](file:///Users/nicholasl/Documents/build-whatever/deepseek-harness/packages/session/session-telemetry-otel/README.md) |
| `session-stats` | turn/step 计数、llmMs/ttftMs/decodeMs/toolMs 全程折叠投影 | [stats README](file:///Users/nicholasl/Documents/build-whatever/deepseek-harness/packages/session/session-stats/README.md) |
| `feedback` 族 | `feedback/record`（log-only session 事件，可触发 FEEDBACK_ONLY 导出）+ message-feedback（storage-domain sidecar，**不进 log、不进 telemetry**） | [feedback README](file:///Users/nicholasl/Documents/build-whatever/deepseek-harness/packages/feedback/README.md) |
| `invariants` | 运行时不变量注册表（`ctx.invariants`），包级隔离 | [invariants README](file:///Users/nicholasl/Documents/build-whatever/deepseek-harness/packages/runtime-diagnostics/invariants/README.md) |

**缺口**：无 span/trace 层（OTel 后端里画不出层级调用链）；无跨 session 的 workflow-run 视角；无 dataset/experiment/score 概念；feedback 与评估互不关联；无 fleet 管理面。注意 seam 契约是**每 context 一个 backend，重复加载抛错**——加 traces 导出是第二个 sink 还是改造 seam，是个设计点。

## 1. OpenTelemetry GenAI 语义约定现状

- **2026 年迁库**：全部 `gen_ai.*` 约定从主 semconv 仓库移入专用仓库 [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai)，主仓库对应条目已标 deprecated/moved（[release note #3696](https://github.com/open-telemetry/semantic-conventions/releases)）。
- **全部 Development 状态**：每个 `gen_ai.*` span/metric/event/attribute 都是 Development（badge 见 [gen-ai-agent-spans.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)）。第三方文章常误传"已 stable"，primary source 不支持（[对比佐证](https://dev.to/azena-ai/opentelemetrys-genai-semantic-conventions-are-not-stable-yet-heres-what-actually-shipped-in-2026-3mke)）。含义：**采用时必须 pin 版本并预期 breaking changes**。
- **Agent/框架 spans**（[gen-ai-agent-spans.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)）：
  - `create_agent {agent.name}`（CLIENT）、`invoke_agent {agent.name}`（CLIENT，远程调用）、invoke agent **internal**（INTERNAL，本地框架执行）、`invoke_workflow`、`plan`、`execute_tool`。
  - 关键属性：`gen_ai.operation.name`（预定义值含 `invoke_agent` / `invoke_workflow` / `plan` / `execute_tool` / `chat` / memory 系列）、`gen_ai.provider.name`（**well-known 值里有 `deepseek`**）、`gen_ai.agent.{id,name,version}`、`gen_ai.conversation.id`、`gen_ai.usage.{input,output,cache_read,cache_creation}.*tokens`、Opt-In 的 `gen_ai.input.messages` / `gen_ai.output.messages` / `gen_ai.system_instructions`（结构化 JSON）。
- **Inference/tool spans**（[gen-ai-spans.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md)）：Inference / Embeddings / Retrievals / Fetch response / Memory / Execute tool 六类，含 buffered 与 streaming chunk 两种内容捕获方式。
- **Events**（[gen-ai-events.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-events.md)）：`gen_ai.client.inference.operation.details` 和 **`gen_ai.evaluation.result`**（评估结果事件，SHOULD 挂在被评估的 operation span 下）——后者对 EVO 直接有用。
- **Metrics**（[gen-ai-metrics.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md)）：`gen_ai.client.token.usage`、`gen_ai.client.operation.duration`、`time_to_first_chunk`、`time_per_output_chunk`、server 侧同套、`gen_ai.invoke_workflow.duration`。
- **MCP 约定**（[mcp.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md)）：client/server spans + 4 个 duration metrics + transport 记录。

**判断**：约定覆盖面（agent→workflow→plan→tool→inference 的层级 + usage/latency metrics + eval 事件）恰好是 daypaw 四支柱需要的词汇表，但全是 Development——**照抄语义、pin 版本、隔离在自己的投影层里**，不追新。

## 2. 三平台数据模型与嵌入性

| | LangSmith | Langfuse | Arize Phoenix |
|---|---|---|---|
| 核心模型 | Trace→**Run**→Span 三层，每 Run 带 `parent_run_id`；threads 汇聚 traces；datasets/examples；**offline eval 打 datasets、online eval 打 runs/threads**；annotation queues（[observability-concepts](https://docs.langchain.com/langsmith/observability-concepts)、[evaluation-concepts](https://docs.langchain.com/langsmith/evaluation-concepts)） | Trace→嵌套 **Observation**（span/generation/event 三型）；session 分组 traces；scores、datasets+experiments、prompts（[data-model](https://langfuse.com/docs/observability/data-model)） | Trace→**Spans**；evaluations 打 traces & spans；datasets（从 traces 收集）；experiments 对比不同版本在同一 inputs 上的结果（[docs](https://arize.com/docs/phoenix)） |
| 摄入 | LangChain SDK 优先 | **OTel-based**，OTLP 可入，不锁 SDK（[data-model](https://langfuse.com/docs/observability/data-model)） | **OTLP-native**（HTTP `/v1/traces` + gRPC :6006，OpenInference 标准）（[configuration](https://arize.com/docs/phoenix/self-hosting/configuration)） |
| 自托管 | SaaS-first（企业版才有自托管） | Docker Compose（ClickHouse+Postgres+Redis+MinIO 四件套，与云同构）（[self-hosting](https://langfuse.com/self-hosting)） | 单容器可跑；**SQLite 默认、Postgres 可选**（[architecture](https://arize.com/docs/phoenix/self-hosting/architecture)、[config.py](https://github.com/arize-ai/phoenix/blob/main/src/phoenix/config.py)） |
| License | 商业 | **MIT core**（tracing/eval/prompt/experiment 全含，无用量上限；EE 仅 SCIM/审计/保留策略）（[open-source](https://langfuse.com/handbook/chapters/open-source)） | **ELv2**（自托管免费无功能门槛，禁转售 managed service）（[license](https://arize.com/docs/phoenix/self-hosting/license)、[LICENSE](https://github.com/Arize-ai/phoenix/blob/main/LICENSE)） |
| 对 daypaw 的可嵌性 | 差（SaaS、框架耦合） | 中（OTel 入口对路，但部署重、数据模型是它的不是我们的） | **好**（OTLP+SQLite 最贴合单机自用；Python server 但只当外部后端用，不嵌入进程） |

**共同抽象**（三家的并集，即「LLM 观测的最小词汇」）：trace（一次顶层请求）→ 嵌套 span（generation 是带 token/模型的 span 特化）→ session/thread 分组 → score/feedback 挂 span 或 trace → dataset（可从 trace 收集）→ experiment（同一 dataset 上跑多版本对比）。

## 3. Fleet 级管理面形态

- **Temporal Web UI**（[docs.temporal.io/web-ui](https://docs.temporal.io/web-ui)）：**durable 系统管理面的最佳参照**。workflow 列表 + search attributes 过滤/saved views/task-failures 预置视图；单次执行的 **history 事件视图**（~40 种事件类型，Timeline/JSON，可下载）；控制操作 Request Cancellation / Signal / Update / **Reset** / Terminate / 「像这个一样再跑一个」；parent/child 层级树；per-task-queue 的 workers 可见性；pending activities；schedules 列表。注意它**没有**跨 worker 的 fleet 指标页——workers 只按 task queue 可见。
- **LangGraph Platform**（[control plane](https://langchain-ai.github.io/langgraph/concepts/langgraph_control_plane/)）：控制面（管 Agent Servers/deployments 的 UI+API）与数据面分离，**数据面 listener 轮询控制面 API，控制面永不直连数据面**——pull 模型让 NAT/防火墙后的 agent 可达。Temporal 亦把 LangGraph 视为框架层、自己当执行层（[blog](https://temporal.io/blog/temporal-langgraph-plugin-durable-execution)：失败恢复、HITL 等数天、崩溃存活）。
- **Idun Agent Platform**（[docs](https://idun-group.github.io/idun-agent-platform/)）：OSS 的 agent 控制面——统一部署、观测、memory、guardrails、API、访问控制，把 LangGraph/ADK/Haystack agent 变成服务。证明「多框架 fleet 控制面」是个正在成型的品类。
- **Dify / n8n**：工作流产品自带观测面板（n8n 的 [agent observability 实践](https://blog.n8n.io/ai-agent-observability/)），形态是「内嵌于编排产品的 trace 视图」，不独立成 Manager。

## 4. 核心回答

### 4.1 Manager 最小完备数据模型（三层）

1. **Canonical 层（已有，勿动）**：dsh session log。"model-visible means logged" 不变量意味着**任何重放/审计都不缺料**。Manager 不新建事实源。
2. **Trace 投影层（新，OTel 导出）**：把 session/engine 事件投影为 GenAI semconv spans——`turn ≈ invoke_agent internal`、`step ≈ inference span`、`tool/call→tool/result ≈ execute_tool`、`workflow run ≈ invoke_workflow`（依赖「Durable Execution 语义与基座」票的 run 概念）；metrics 用 `gen_ai.client.token.usage` / `operation.duration` / `ttft`；EVO 评估可吐 `gen_ai.evaluation.result` 事件。投影是**只读派生**（同 session-stats 的折叠模式），从 live 事件或 canonical 重放皆可生成。
3. **本地关联层（新，SQLite，复用 storage-sqlite 模式）**：score/feedback/eval-run/dataset/experiment 五张小表，全部以 `(session.id, event.seq)` 指针指回 canonical log，**不复制内容**。EVO 的确定重放与 provenance 锚在这里。

### 4.2 OTel 导出 vs 本地存储的分界

**判据：横向操作遥测走 OTel；纵向高保真回放数据留本地。**

- 走 OTel（traces/metrics/logs，可丢、可采样、面向监控告警与跨系统对比）：latency、token 用量、错误类型、agent/workflow 调用链形状。dsh 的 redact waterfall + 去重 + 谱系缝合机制原样复用，只是从 log 信号扩到 trace 信号。
- 留本地（canonical log + SQLite 关联库，不可丢、面向重放/评估/优化）：消息全文、工具结果全文、feedback、eval 结果、dataset 条目、experiment 对比。理由：OTel 后端没有重放语义（Phoenix/Langfuse 都不能从 trace 重放执行）；EVO 需要 `(session.id, seq)` 级确定性锚点；dsh 已证明 log 是重放的唯一来源。

## 5. 对 daypaw-pro 的含义（决策输入）

1. **不整体引入任何一家平台的数据模型**——Langfuse/Phoenix 的 trace→observation→eval 模型作为词汇参考，实体留在自己手里（canonical log 为锚）。可选把 Phoenix 当**零成本起步的 OTLP 后端**（单容器 + SQLite，ELv2 自用合规）。
2. **Manager 的 UI 参照 Temporal Web UI 的信息架构**（列表/搜索 → 单执行 history 事件视图 → 控制操作），而不是 LangSmith 的 trace 瀑布图——因为我们的执行是 event-sourced 的，history 视图与 canonical log 天然同构；控制操作集（cancel/terminate/reset/re-run/signal）与 durable engine 的能力面对齐（喂给「Durable Execution 语义与基座」和「Manager 范围与控制面」票）。
3. **控制面-数据面用 pull 模型**（LangGraph Platform 的教训）：Manager 不直连 agent 进程，agent/worker 轮询或上报——与 dsh 的 SDK server/headless 多进程形态吻合。
4. **EVO 数据契约**：eval 结果双向——本地 SQLite 关联库为 truth（锚 `(session.id, seq)`），OTel `gen_ai.evaluation.result` 事件为可选的横向可见性（喂给「EVO 循环机制」票）。
5. **seam 设计警报**：`sessionTelemetry` 契约每 context 只容一个 backend；trace 投影要么成为该 seam 的第二实现（与 otel 后端互斥，不好），要么新开 `ctx.traceProjection` 一类 seam（推荐，喂给引擎包结构 fog）。

## 6. 开放问题（留给「Manager 范围与控制面」票）

1. trace 投影从 live 流生成还是 canonical 重放生成（FEEDBACK_ONLY 已有重放先例；live 有 crash 丢窗）？durable outbox 的需求边界（seam README 已把它列为 deferred）？
2. span 粒度映射表：turn/step/chunk/tool-call 到 span 的确切对应与属性填充（哪些 Opt-In 内容属性默认开）？
3. GenAI semconv 全 Development：pin 哪个 tag、升级节奏、要不要在投影层做版本适配器？
4. Manager UI 复用 dsh web app（ConversationNode 体系）还是独立轻量面？（已在图 fog 里）
5. Phoenix 作为推荐后端 vs 严格后端无关（只保证 OTLP 合规）？
6. fleet 视角的最小集合：agent 定义列表、活跃 run、失败率、成本（token）聚合——够不够，要不要 schedules/workers 页？
