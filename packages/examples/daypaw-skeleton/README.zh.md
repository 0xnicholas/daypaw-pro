---
description: "可运行演示：daypaw 走骨——能在真 SIGKILL 下存活的三步 durable workflow，外加支柱②的 agent 编译面跑在真实 dsh agent 栈上。"
kind: "package-reference"
---

# daypaw-skeleton 示例

[English](README.md) | 中文


## 概述

## 目录


daypaw 走骨的可运行演示（[ADR 0008](../../../docs/adr/0008-landing-order-walking-skeleton.md)）：一个在真 `SIGKILL` 下存活的三步 durable workflow，外加支柱②的 agent 编译面（[ADR 0010](../../../docs/adr/0010-define-agent-compilation-and-execution.md)）跑在真实 dsh agent 栈上。

## 运行

```sh
node --import tsx/esm examples/daypaw-skeleton/src/main.ts \
  --db /tmp/demo-ledger.db --effects /tmp/demo-effects.log \
  --run-id demo-1 --step-delay-ms 300
```

运行中杀掉（`kill -9`），随后不带 `--runId` 重启：boot 扫描复活未完 run，已完成 step 返回已记录结果不再执行，run 以类型化输出收尾。带 `--run-id` 重启则 attach 同一 run 并打印结果。

`cordis.yml` 是演示组合（engine 落本地 ledger 文件）；[tests/sigkill.spec.ts](tests/sigkill.spec.ts) 是证明线套件——第一步效果出现后杀死，断言已完成 step 恰一次与带类型化结果的 `done` 行。

## Agent 演示

[src/agent-main.ts](src/agent-main.ts) 跑一个 workflow，其 step 经 `ctx.agent` 等待一个 `defineAgent` 编译的子 run，dsh agent 栈为真实组合，LLM 路由由脚本化 replay override 免 key 供给：

```sh
node --import tsx/esm examples/daypaw-skeleton/src/agent-main.ts \
  --db /tmp/demo-ledger.db --sessions /tmp/demo-sessions \
  --override examples/daypaw-skeleton/tests/snapshots/agent-happy/replay.override.json \
  --run-id agent-demo-1
```

[tests/agent.golden.ts](tests/agent.golden.ts) 钉住模型可见面：持久化 session log 与提交的期望输出对 diff（persona prompt 段、注入的 `submit` schema、输入消息）；第二个场景在轮中 SIGKILL 宿主、重启，并钉住复活后模型看到的合成续跑 steer。

第三个场景经 `--mode steer` 走 steer 通道（issue #53），直接驱动一个独立的 steerable 定义：[tests/sigkill.spec.ts](tests/sigkill.spec.ts) 让 run 在无 submit 的轮次后停泊，SIGKILL 宿主，再以 `--steer` 段在同一 runId 下复活并完成；快照套件则钉住同一份同时承载初始输入与被 steer 追问的 session log。

## Model Experience

### workflow 演示

#### 模型可见面

无。workflow 演示不编排模型调用；其三个 durable 步骤是纯计算，不贡献 prompt、工具或 schema。

##### workflow 步骤记录

```markdown
The skeleton workflow executes three chained durable steps (first, second, third); each step records its side effect to the effects file before returning, and a killed host resumes at the step boundary on revival. No model-visible content is produced.
```

#### Token 效果

零实时请求 token。

#### KV Cache 效果

无：演示不增加任何请求前缀内容。

### agent 演示

#### 模型可见面

agent 演示的模型可见面即其快照所钉内容，见上。

##### agent 轮次记录

```markdown
The agent demo drives a real dsh agent loop over the durable engine: the session log carries the user prompt, the assistant reply, and the steered follow-up, all replayable from the ledger.
```

#### Token 效果

由单一钉住的快照轮次限定。

#### KV Cache 效果

无：演示不增加任何请求前缀内容。

## Known Limitations and Deferred Work

- **宿主是演示** —— 参数解析与 effects 日志为 SIGKILL 套件存在；真实宿主以同一插件行组装自己的 Cordis 应用。

### 开发备注
