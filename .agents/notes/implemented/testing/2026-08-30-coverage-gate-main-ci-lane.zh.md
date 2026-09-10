# Agent Note: 覆盖率门修复与 fork 自有 main CI 车道

Status: implemented

[English](2026-08-30-coverage-gate-main-ci-lane.md) | 中文

## Problem

per-file 100% 覆盖率门从未在本 fork 的 CI 上跑过:继承的 `CI` 工作流 `pull_request` 作业解析到上游 org 的 runner 标签(`dsh-ubuntu-24-04-16core`),本 fork 不存在——dependabot run 排队数小时直至超时;`CI master` 只监听上游默认分支 `master`,永不触发本 fork 的 `main`。本地跑门则红在三处:`daypaw/ui-tasks/src/client/task-list.tsx`(branch 96.15%)、`daypaw/ui-inbox/src/client/index.ts`(lines 97.87%)、`daypaw/engine/src/core.ts`(branch 99.57%,`settledResult` 的 failed 行路径)。

## Decision

- ADR 0007 §1 按裁决落地:`vitest.config.ts` coverage exclude 增一条 glob `packages/daypaw/ui-*/src/**`(登记于 `docs/fork/CORE_TOUCHES.md` 的 core touch),镜像上游对 client UI 的 GUI 债豁免——jsdom 组件测试与组装 web 车道保留,per-file 门不适用;daypaw 的 host 侧包仍走门。
- engine 的缺口补测而非豁免:crafted-row 测试新增对 `error_json` 非空的 `failed` 行的 attach,走 `settledResult` 的 `JSON.parse` 方向(此前唯一一次过该分支的输入 `error_json: null`;真实失败经 runner 结算,永不走 attach 重放)。`engine/src/core.ts` per-file 100%。
- main 推送经新 fork 自有工作流 `.github/workflows/ci-daypaw-main.yml` 获得按确定性拆分的 CI。必需作业跑加性 `ci-daypaw-hosted` 聚合(`scripts/run-gates.ts` core touch):上游主聚合的全部确定性 gate——静态检查、typert 契约、typecheck、lint、duplication、node 冒烟、doc-sync、module graph、knip、build、publint、node-next types、built invariants、bin smoke。advisory 作业(`continue-on-error`)跑三条全量道(coverage、录制会话快照重放、web 浏览器快照——其浏览器时序测试在 hosted 硬件上同样边缘,Playwright 就位后仍跨运行成败):其时序敏感测试在 4-vCPU hosted 硬件上测的是宿主而非代码(上游在 16 核企业 runner 上跑、其自身 hosted 串行参照本就禁用),故按推送报告而不设门。恢复为门需要企业级 runner 或上游稳定化。车道首跑期间,必需门共捉到四个真缺陷。
- 车道只钉 `DSH_GATE_CONCURRENCY=1`——gate 串行,4-vCPU runner 永不同时扛两条车道(首跑正败于此),每条车道保留自身的套内并行,与上游 pull-request 车道的执行形态一致;standby 的全量串行钉定面向其更弱的单用途 VM,在 hosted 硬件上饿死时序敏感的进程测试,串行化后又因缺少 standby 同样要准备的 hosted 环境(Playwright Chromium、解除用户命名空间限制的 bubblewrap)而失败,同一次运行还暴露了死车道放过的真违规——`agents-dir.ts` 的动态工厂导入赋值 `any`(`no-unsafe-assignment`);导入现按文件边界结构化类型。快照道暴露第三处:corpus 契约把 `.snapshot.ts` 后缀全仓保留给白名单中的五个录制会话适配器,而六个 fork 测试文件占用了它——daypaw-web 的 golden 回放与 skeleton 的 CLI 回放——遂按 `docs/testing.md`「属主本地的预期输出不用保留后缀」的规则改名 `tests/**/*.golden.ts`;skeleton 的回放其后离开 `.golden.ts` 后缀、以 `agent.spec.ts` 收编进默认道([死道修复](../bug-fix/2026-09-09-skeleton-agent-replay-dead-lane.zh.md))。pwsh 真壳用例的 harness 时序放宽(idleSilence/handoffGrace 300→2000ms,经其一等 timing 形参):hosted 4-vCPU 上冷 pwsh 的 profile 引导静默超过默认边界,`inferred_idle` 会先于 `stdin_read` 获胜。
- advisory 作业在 install 与其车道之间构建工作区(`pnpm run build`:lib 面 + 两侧 web 前端构建),逐文件覆盖率门同时排除可运行示例的源码(`packages/examples/daypaw-skeleton/src/**`,已登记 core touch):全量道加载的是构建面——coverage 从 install anchor 修复隔离 profile(agent-plane、web-app roster、skeleton 回放),浏览器重放供给构建出的前端 dist——而示例的源码只作为 vitest 无法插桩的 tsx 子进程执行,逐文件阈值只能以豁免收口。车道的净树 hosted 检出上,加载依赖套件直接加载失败——先表现为丢套件文件的逐文件 coverage 阈值红,`agent-plane.spec.ts`(#103)落地后则表现为插件树加载的套件级红——skeleton 排除则收掉构建树上也存活的唯一一条阈值红(fork issue #108 与 #111);车道每个运行都红在 coverage,两条重放步被饿死在其后,直至两者落地。
- 两作业的门前置都跑 `scripts/prepare-ci-bubblewrap.sh`;Playwright Chromium 仅 advisory 作业安装。bubblewrap 并非只有快照重放需要:必需作业的 built-bin smoke 让 headless keyless profile 经生产 shell 工具以 `workspace-write` 沙箱模式执行,宿主无可用沙箱后端时按设计拒绝无沙箱运行。web 浏览器快照道移入 advisory 时,其环境预备一并离开了必需作业,此后每个 main 推送都在 built-bin smoke 上红掉确定性聚合(`SandboxUnavailableError`),直至该步恢复(fork issue #109)——作业的环境预备归它所跑的门所有,而非归这些步骤最初为之编写的车道。
- 死掉的继承 `CI` 工作流经 GitHub UI 禁用(可逆、零 core touch——ADR 0007 §5 先例),卡死的排队 run 已取消。`CI master` 不动:本 fork 永不推送它监听的分支,无法触发。

## Alternatives considered

**把 `ci-master.yml` 改指 `main`。** 否决:其作业假设自有 self-hosted standby 池与 Wine 缓存播种;无这些 runner 车道会永远排队,且改动是对上游文件的宽面 core touch。

**给继承 `ci.yml` 加 `push: main`。** 否决:每个作业都以 `github.event_name == 'pull_request'` 为条件并读 PR 上下文(base sha、user login),只加触发器什么都跑不起来;适配条件比 fork 自有文件付出的 core touch 更大。

**补齐 ui-* 缺口而非落 glob。** 否决:ADR 0007 §1 已按上游自身先例裁决家族姿态;在 jsdom 宿主上追组件的 per-file 100% 买不到组装车道没有的验证。

## Consequences

- 三处门失败消除:`engine/src/core.ts` 量得 100%,两个 `ui-*` 文件被豁免,scoped 覆盖率跑不再触发阈值。
- 聚合步骤在 90 秒冷却后重试一次:4-vCPU hosted runner 上文档化的边缘宿主 flake 家族(session-projection-cache、inspector host 集成、pwsh 会话重放)每次轮换成员,上游在 16 核企业 runner 上跑这些车道、且其 hosted 串行参照本就禁用。真失败会连败两次保持红。
- 本机全量 `pnpm run test:coverage` 仍会在文档化的 Node 26 flake 集上中断(10 个文件 12 失败;11 个文件中 10 个隔离跑通过,`session-projection-cache` 隔离跑红与 sync 笔记基线记录一致)。权威门判定属于新的 node-24 CI 车道;本地 flake 红是基线,不是回归。
- 未来的 daypaw `ui-*` 包自动落入 glob;host 侧 daypaw 包若未达标,main 车道会响亮失败。
