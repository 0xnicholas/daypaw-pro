# Agent Note: 弹窗启动负载嵌套在 `request` 参数名下

Status: implemented

[English](2026-08-31-daypaw-start-run-args-envelope.md) | 中文

## 问题

daypaw 新任务弹窗每次提交都内联失败，每个实例都一样：名册正常加载，引擎 ledger 却从未落过一行。Typert 网关拒绝 `durable/startRun`，报 `args fields do not match the descriptor: missing "request"; unexpected "defName", "defVersion", "input", "runId"`——网关按 Remote 方法的具名参数校验 args 键，而 `startRun(request: StartRunRequest)` 的唯一参数名是 `request`，网关的键校验因此拒绝 `{ args: request }`——它把 `defName`、`defVersion`、`input`、`runId` 放在期望单个 `request` 键的位置。描述符校验只在网关发生：daypaw 的全部 web 黄金道跑在 keyless fixture 传输上，它回放预设负载、不校验 args 键；tarball 冒烟只覆盖 URL 行与 dist 服务。

## 决策

`new-task-api.ts` 投递 `{ args: { request } }`；`@daypaw/web-app` 的 wire 契约 spec 起真实的 Typert registry、网关与 durable 引擎：名册经 `listDefinitions` 列出、弹窗形状的 `startRun` 落出 ledger 行且输入取自 wire face 的收拢、摊平 args 被描述符校验拒绝且不写 run。该 spec 是 args 信封的执行化证明；fixture 传输道继续充当模型可见的黄金面。

## 备选与否决

**把引擎参数改名成 defName 一族让摊平恰好对上。** 否决：多参数端点（`steer(runId, input)`）已经钉死具名参数分发，客户端无论如何都得按参数名嵌套。

**按手抄描述符校验弹窗的 `args` 键。** 否决：抄本会像它要防的 bug 一样漂移；网关才是描述符的唯一事实源。

**给 fixture 传输加上描述符校验。** 否决：fixture 的职责是为黄金道提供确定性预设答案；在那里复刻网关校验等于造第二个网关。

## 后果

一次弹窗提交即写出 run 行并打开对话。`@daypaw/web-app` 为契约 spec dev 依赖 `dsh-typert-registry` 与 `dsh-api-gateway`。今后任何 `durable/*` 客户端调用，只要黄金道无法校验其 args 键（fixture 从不拒绝），都需要同样的网关背书契约用例，否则 args 不匹配会无声上线。
