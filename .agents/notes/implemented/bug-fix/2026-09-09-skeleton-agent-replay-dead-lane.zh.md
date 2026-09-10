# Agent Note: 骨架 agent 回放收编进默认 vitest 车道

Status: implemented

[English](2026-09-09-skeleton-agent-replay-dead-lane.md) | 中文

## Problem

`#72` 的后缀改名（`5a2044cd2d`，2026-08-29）把骨架的 `tests/agent.snapshot.ts` 改成 `agent.golden.ts`，但没有任何 vitest 车道的 include 匹配新名：默认道取 `packages/*/*/tests/**/*.spec.{ts,tsx}`，web-daypaw 车道的 include 只列了 `apps/daypaw-web/tests/**/*.golden.ts`（该提交改的是模式的后缀，不是目录）。vitest 的 CLI 路径参数是对 include 的过滤而非覆盖，即使显式 `vitest run <路径>` 也拒绝该文件。自 2026-08-29 起 defineAgent 编译面回放从未执行，无守卫状态持续累积：提交的金样停留在 Session 格式 v0，而写入器已产出 v2（逐事件 `seq`/`time` 封套、chunk 折叠进落定的 `assistant/message` 流）；复活场景的杀前等待轮询的是逐 chunk 持久记录——`'partial'`——折叠流格式只在尝试落定时写出它，而 `SIGKILL` 抢先于落定（ticket #108）。

## Decision

回放以 `packages/examples/daypaw-skeleton/tests/agent.spec.ts` 之名在默认道执行，即金样文件的 `git mv`。它与同目录 `sigkill.spec.ts` 共享执行形态——tsx 源启动子进程、真实 `SIGKILL`、持久化 session log 与台账断言——不需要浏览器引导、不依赖构建产物，且 `docs/testing.md` 本就把包属预期输出指派给 `test`。web-daypaw 车道从此独占 `.golden.ts` 后缀，只载装配浏览器回放。

三份提交的金样已刷新（`DSH_SNAPSHOT=refresh`），以仓规 canonical packed 夹具布局（`scripts/session-fixture-layout.ts`）落为 `session.v2.jsonl`：按文件名/头版本规则带版本命名、持久化 `seq`/`time` 封套投影去除、chunk 折叠进落定 `assistant/message` 事件的 `stream` 数组、`isSeeded` 头字段。三个场景的事件类型次序此外不变。因 spec 内联钉住 request/header 负载（persona 段、`submit` schema），其比较以新导出的 `projectSessionSnapshot` 组合裸 `normalizeSessionLog`（同出 `dsh-session-snapshot`）——完整的 `normalizeSessionSnapshot` 管线会把负载换成 `{{system}}`/`{{tools}}` 令牌（已登记 `docs/fork/CORE_TOUCHES.md`）。

复活场景在杀宿主前等待持久的 `request/context` 记录。折叠流下该记录是模型调用在飞的最后持久证据；同样的持久日志标记惯用法本就治理 `sigkill.spec.ts` 的驻留等待（`turn/end`）。若 hang 条目行为异常、宿主提前退出，随后的 `process.kill` 以 `ESRCH` 失败，场景大声红。

## Alternatives considered

**把 `packages/examples/daypaw-skeleton/tests/**/*.golden.ts` 加进 web-daypaw 车道的 include。** 否决：该车道从构建浏览器 bundle 引导，CLI 回放用不上；在浏览器引导后串行（`fileParallelism: false`）；且不进任何 fork CI 作业——advisory 作业回放的是上游 web 车道（`test:web:built`），不是 `test:web:daypaw:built`——文件在 CI 里仍不会执行。

**经 llm-replay 的 `readyFile` 侧信道继续证明流已开启**（运行时派生 hang override，同 `apps/web/tests/subagent-interrupt.e2e.ts` 的构造）。否决：它能证明内存中的流已打开，但持久日志不再能承载该事实，且同目录惯用法是持久日志等待；提交的 hang 夹具也将因 `readyFile` 按宿主 cwd 解析而需要逐运行派生。

## Consequences

`pnpm exec vitest run packages/examples/daypaw-skeleton` 在默认道无需显式路径即运行两个 spec 文件（六例）全绿；文件进入覆盖率车道的 include，fork 的 advisory CI 作业全量执行它。`.golden.ts` 后缀从此与装配 web 车道一一对应。

既存且已由 #111 收口：`packages/examples/daypaw-skeleton/src/**` 在 v8 逐文件门下计 0%，因为这些源码只作为 vitest 无法插桩的 tsx 子进程执行；fork 的 advisory 覆盖率作业自该包落地起带着这条红，直至 `vitest.config.ts` 的排除落地（见[CI 车道 note](../testing/2026-08-30-coverage-gate-main-ci-lane.zh.md)，已登记 core touch）。

重跑操作注记：被杀宿主加载 `fs-ext`（POSIX session 租约面），车道必须在构建了工作区原生模块的 Node 大版本下运行；ABI 不匹配时每个场景在断言前即以 `ERR_DLOPEN_FAILED` 失败。
