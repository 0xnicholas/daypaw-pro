# Agent Note: ModelRoute 增 reasoningEffort;引擎开 durable/cancel

Status: implemented

[English](2026-08-31-model-route-effort-and-durable-cancel.md) | 中文

## Problem

首个产品壳真实 run 捉获的两处产品缺口(ticket #74)。`ModelRoute` 只有 provider/model/maxTokens,定义无法声明推理档;deepseek 适配器默认档为 `high`,`deepseek-v4-flash` 把 8192 输出预算全部花在推理上(finish 原因 max-tokens),到不了任何可见块或 `submit` 调用——连续两回合。Remote 面没有取消:`RunHandle.cancel` 存在,但停车 run 无法从产品路径取消,只能 steer 推到终态。

## Decision

`ModelRoute.reasoningEffort?: ReasoningEffortId` 走编译 body 已安装的模型选路面——`installModelSelection` 的请求瀑布应用所选档并清除继承档,选路面是唯一持有者(agent options 的档会被缺席的选路档剥除)。`LlmRuntime` 按适配器声明集校验档位,不支持的档每请求 loud 失败。未声明保持 provider 配置/默认行为。

引擎私有的 cancel-run 抽取转为公有 `cancel(runId, cause?)`:先落带 cause 的终态 `cancelled` 行,pending gate 结算 cancelled,然后 driver abort。对终态 run 幂等——请求的后置条件已成立——但 abort 永远执行,因为终态写入与 abort 之间的故障可能留下越过终态行的滞留 driver(故障注入套件钉住此点)。未知 run id loud 失败。服务以 `@Remote('cancel')` 暴露,wire-contract spec 经活网关取消一个 gate 等待中的 run。

## Alternatives considered

**按部署配置档位(profile patch),保持 ModelRoute 窄面。** 否决:部署默认覆盖宿主上所有 agent,而档位是工作负载的定义级属性——同一宿主上 lint agent 要 low、coding agent 要 high。

**终态 run 上 cancel 改为 loud(steer 先例)。** 否决:cancel 是「请该 run 不再继续」的请求;已结束的 run 已满足它,loud 失败会迫使每个调用方处理与自然完成的竞态。

## Consequences

- 壳侧一旦有 UI 入口即可经 wire 取消停车/运行中 run;UI 位本身未裁决(触发:壳需要取消交互)。
- sdk 测试组合的 MockAdapter 接受推理信息,档位断言走真请求校验路径。
