# Agent Note: DurableEngine 销毁先等待 ledger 打开再关闭

Status: implemented

[English](2026-09-14-durable-engine-dispose-awaits-ledger-open.md) | 中文

## Problem

advisory coverage 道首次非确定性现红（[#115](https://github.com/0xnicholas/daypaw-pro/issues/115)）：`packages/daypaw/sdk/tests/agents-dir.spec.ts` 的空名册用例在 `rm` 全文件共享的 `mkdtemp` 根时 ENOTEMPTY。引擎的拆卸 disposer 是同步的，而 `this.ready`（`openLedgerDatabase`）是异步打开：拆卸先于打开完成运行时 `this.db === undefined`、什么也不关，悬着的打开随后在拆卸返回*之后*创建 `ledger-N.db` 与 WAL/SHM 边车——hosted 4-vCPU 负载下这笔落笔恰入拆卸 `rm` 的 readdir→rmdir 窗口。该竞态对全新引擎是确定的：`await ctx.fiber.dispose()` 返回时 ledger 目录为空，300ms 后三个文件出现。同一窗口还会泄漏一个未关闭的 `DatabaseSync` 句柄。

## Decision

- `shutdown()` 改为 async，disposer await 它（cordis 会 await 异步 disposer，因此 fiber 销毁只在它落定后才 resolve）：driver 中止留在 disposer 的同步前缀；在飞的 `openLedgerDatabase` 被等待，打开之后新建的 core 随后被 dispose（幂等），故拆卸后不再有 ledger 落笔。
- driver 中止刻意保持同步前缀位置：先驱动 `ready` 会让已排队的兄弟拆卸（session inbox 投影注销）先于中止落定，`ReactLoopAgent.cancel` 随后读取中止派发已移除的 inbox 投影。

## Testing

- `behavior.spec.ts` 新增回归用例：启动引擎、不触碰 `ctx.durable`（引擎以空名册启动）、销毁，再断言 ledger 目录在有界窗口内字节稳定且不含 `-wal`/`-shm` 边车。窗口只为负观察封界，绝不以时序为断言条件。
- 同步前缀次序下 `agent.spec.ts` 无未捕获异常；`pnpm exec vitest run packages/daypaw/engine packages/daypaw/sdk` 为 211/211，原失败 spec 在 8 路 CPU 负载下保持绿。

## Alternatives considered

**给拆卸 `rm` 配有界重试（议题的备选方向）。** 否决：它掩盖销毁契约违反而非修复——重试界编码的是观测到的竞争而非静默性，且每个未来的「销毁即清理」fixture 都会重新继承这个竞态。

**先 `await ready`，再 dispose 与关闭。** 否决：首个 await 会让兄弟 fiber 的拆卸续延先于 driver 中止运行（见 Decision）；中止 driver 是引擎自己的拆卸时刻，不得与它不拥有的清理交错。

**投影注册失活时让 `ReactLoopInbox.current` 降级。** 否决：`packages/core/agent-loop` 属上游所有（为 workaround 动 fork core touch），且同步前缀契约已使该顺序从引擎销毁侧不可达。

## Consequences

- `ctx.fiber.dispose()` resolve 后引擎不再写 ledger：拆卸可以立即移除 ledger 目录，静默目录至多剩 `.db` 文件（SQLite 末连接关闭即 checkpoint 并解除边车）。
- dispose-先于-open 窗口不泄漏打开的 `DatabaseSync`。
- 残留、任何道均未观测：SDK 的中止路径仍假设组合活过 driver 中止（`agent.cancel` 读 inbox 投影）。引擎销毁按构造保持该假设；显式先销毁 AgentLoop fiber 再销毁引擎的仍可能从中止分发抛出。
