# Agent Note: 组合安定后的配置启动与 ACP 服务

Status: implemented

[English](2026-09-09-loader-settle-startup-races.md) | 中文

## Problem

Loader 以并发方式应用同一棵树里的兄弟条目（`EntryGroup.update` 对各行跑 `Promise.allSettled`），因此插件构造器里用不等待的 `ctx.get` 采样另一条目的服务，就会与该条目的注册过程相竞。在 tsx 源启动路径（`node --import tsx`，`DSH_EXAMPLE_MODE=src` 默认道）上，逐条目的 TypeScript 转译让兄弟导入慢到足以重排启动顺序，两个随附表面输掉了该竞争：

- `dsh-agent-loop` 在构造器里创建配置 agent 并立即采样 `ctx.sessionPersistence`。当 `dsh-session-persistence-jsonl` 条目尚未注册时，`createStoredSession` 拿不到写句柄，配置 agent 以纯内存运行，`.sessions` 永不落盘；进程仍以完整事件流 exit 0（ticket #106，macOS src 模式 6 例 `test:expected` 恒红）。
- `dsh-acp` 在 `apply` 里连接 stdio 传输，客户端因此能在 provider 条目仍在导入时创建会话。`llm/adapters-updated` 随后在首个会话记录存在之后触发，发出录制夹具（录制于 adapter 先于服务注册的组合）不携带的 `config_option_update` 通知。

构建后的 `lib` 启动导入足够快，两个竞争都按录制方向落定，因此 CI（`DSH_EXAMPLE_MODE=lib`）保持绿，而 src 模式在较慢的转译下确定性变红。

## Decision

两个启动决策现在只在组合定局后读取它，均以结构化方式读取 Loader 服务的安定屏障（`ctx.get('loader')` 读作 `{ await(): Promise<void> }`，与 api-gateway 客户端和 web boot 已有的读取相同）：

- `AgentLoop` 把配置（非恢复）agent 路由进 `startConfiguredAgent`：采样 `sessionPersistence`，若未命中且插件归 Loader 持有，则等待 `loader.await()` 后再采样一次。树安定之后缺席即为定局，agent 以纯内存启动——与不挂载后端的组合完全一致；Loader 之外的场景里构造器采样本就定局。安定屏障是尽力而为：`loader.await()` 拒绝（兄弟条目应用失败）时按当前可见性继续，进程结局交给 Loader 的树失败。恢复路径本就正确（`ctx.inject(['sessionPersistence'])` 等待注册），保持不变。
- `dsh-acp` 照旧构建 app 并注册处理器，但只在 `loader.await()` 安定后连接传输；无 Loader（注入 `config.stream` 的单元测试）时立即连接。安定失败的树永不服务。依赖 wire 的绑定（`notify`、权限请求）经单个带守卫的访问器读取客户端——agent 只为 wire 创建的会话存在，因而只在服务开始之后存在。

## Alternatives considered

**让 `createStoredSession` 自身感知安定。** 放弃：所有 create 调用方——web、ACP、subagent——都在启动后运行且服务在场；只有组合声明的配置 agent 在树应用期间启动。把 Loader 等待埋进共享 create 流程会把改动扩大到不可能命中竞争的调用方。

**在 agent-loop 条目或 base bundle 上声明 `inject: [sessionPersistence]`。** 放弃：注入是无条件等待——配置了 agent 却无任何持久化后端的组合（单元测试面、`sdk-minimal` 形态的宿主）将永远不启动其配置 agent，且该依赖属于组合而非通用 loop 包。

**在 `dsh-acp` 里抑制冗余的初始 `config_option_update`。** 放弃：该通知是诚实的会话中拓扑上报；缺陷在于组合未定局就开始服务，而非通知本身。按内容等价过滤还要把桥耦合进它不拥有的响应时序。

## Consequences

只要组合挂载了后端，配置 agent 无论兄弟导入时序如何都确定性地持久化；不挂载时确定性地纯内存启动——src 模式 6 例 `test:expected` 转绿，lib 模式夹具原样回放。ACP 只在组合应用安定后应答首个请求，服务出的目录与能力因此是定局——Loader 持有启动的客户端在 `initialize` 应答前看到有界的启动延迟，而非竞态的拓扑通知。两个等待都是浮动启动（经 `FactoryOwnership` / 插件 effect 追踪），等待期间树拆除会放弃它们，不会死锁 Loader 自身的任务排空。

`packages/core/agent-loop/tests/config-session-id.spec.ts` 钉住四类安定臂（后端迟到仍持久化、安定而无后端则纯内存、安定失败继续、等待中拆除放弃，另有精确 id 后端迟到臂）；`packages/acp/acp/tests/startup.spec.ts` 钉住服务延迟。两个被改源文件在所属测试套件下保持 100% 覆盖。上游携带缺陷与修复已登记 `docs/fork/CORE_TOUCHES.md`，标记为下次 sync 的上游 PR 候选。
