# Agent Note: fork 复用边界记录迁移现行上游包名

Status: implemented

[English](2026-09-06-reuse-boundary-current-package-names.md) | 中文

## Problem

上游 2026-08-28 sync 载入了一次 client 栈重组：`packages/client/runtime` 拆为 `store`（store 契约）、`ui-conversation`（会话域层：registries/assembler/contract）、`ui-chat`（chat 模型层：partial 节点、steering history、tool-call tree）；`render-service` 更名 `ui-renderer`（并入 `runtime` 的 `slots.ts`）；`web-react` 并入 `ui-renderer`（`cf5e686408`）；`schema-form` 并入 `ui-settings`（`56dff07c4e`）；旧 `ui-conversation` 的聊天表现整体搬进新 `ui-chat`，其名让位域层。fork 的复用边界记录早于这次重组：spec 05 §4 的整包复用簇仍列 `runtime`/`web-react`/`schema-form`，重写簇以旧 `ui-conversation` 打头，而 `docs/fork/CORE_TOUCHES.md` 只提及 `connection` 与 `ui-theme`（均为现行名）。对照现行树阅读任一记录都会新旧纪混用——同一个 `ui-conversation` 在一份清单里是重写对象、在现行 roster 里是复用包，且 `apps/daypaw-web/vite.config.ts` 的 alias 块仍把 `@deepseek-ai/dsh-client-schema-form` 指向 sync 已删除的目录（另一行 `dsh-client-ui-attachment` 则比曾消费它的 platform-module 表条目活得更久）。

## Decision

依 wayfinder [#80](https://github.com/0xnicholas/daypaw-pro/issues/80) 裁决 4，记录只使用现行包名（[#89](https://github.com/0xnicholas/daypaw-pro/issues/89)）：

- spec 05 §4 的整包复用簇为现行 14 包——connection、locale、modules、web、ui-slots、ui-settings、ui-theme、ui-primitives、ui-attachment、hmr + store、ui-conversation、ui-chat、ui-renderer——重组前的名字映射在簇头一句话说清；簇员合计 40（14 + 15 + 11）、现行包 39，ui-chat 跨整包复用与重写两簇。
- 重写簇的聊天表现成员是 `ui-chat`，其重写范围只覆盖旧 `ui-conversation` 并入的聊天表现面；ui-chat 的模型与装配供数层仍整包复用（fork roster 整体装载 ui-chat，`@daypaw/ui-tasks` 在其上绘业务语言视图）。供数句改为 `ui-conversation` 的 ConversationNode 装配机——`runtime` 装配机的现居地（`ui-conversation/src/client/conversation/assembler.ts`，由 `@daypaw/ui-tasks` 消费）。
- vite 的两条过期 alias 行删除；捆绑壳图（`apps/daypaw-web/src` + 别名指向的 `packages/client/web/src` 链）没有任何 import 使用这两个 specifier，两行本就惰性。

重组前的名字只保留在带日期的研究记录（`docs/research/2026-09-02-upstream-drift-client-stack.md` §0 持有带 SHA 的更名证据）与 spec 的一句桥接说明里——后者需要旧名才能让 [#36](https://github.com/0xnicholas/daypaw-pro/issues/36)/[#37](https://github.com/0xnicholas/daypaw-pro/issues/37) 的裁决来源保持可推导。

## Alternatives considered

- **逐字保留裁决文本作为历史记录** —— 拒绝：spec 05 是现行状态散文；包名在树上不再解析的边界清单对未来任何读者与 grep 都是失败的。
- **迁移时顺带再裁决边界** —— 拒绝：wayfinder #80 裁决 1 维持了全部簇裁决（「存量边界全簇维持」）；ui-chat 的双重列名（整包复用的层 + 重写的表现面）是该裁决忠实的现行名读法，不是新决定。
- **保留惰性的 vite alias 行** —— 拒绝：`schema-form` 行的目标目录已不存在；点名已消失包的死配置正是本次迁移要消除的新旧混用。

## Consequences

spec 05 §4 的簇成员、计数与供数陈述均可在现行树上解析；§4 路线 B 句中的 `web-runtime` 不动（它指 `bundle/web-app` 的胶水插件行，不是 client 包）。代价：spec 多带一句重组前词汇让旧 #36/#37 记录可推导，且下次 sync 的 CORE_TOUCHES 重放须记得已关闭 issue 里的「13 整包复用」即现行的 14 包。换来：任何现行状态 fork 文档都不再点名上游树解析不了的 client 包，alias 块重新只列壳图真实 import 的 specifier。

## Verification

对 `docs/spec/`、`docs/adr/`、`docs/fork/`、`CONTEXT.md` 的 `grep` 显示：除 spec 桥接句外无任何 `runtime`/`render-service`/`web-react`/`schema-form` 的 client 包提及（`web-runtime` 作为插件行 id 排除）；`docs/fork/CORE_TOUCHES.md` 只提及 `packages/client/connection` 与 `packages/client/ui-theme`。删除 alias 行后前端构建（`pnpm --filter @daypaw/web-frontend run build`）通过。
