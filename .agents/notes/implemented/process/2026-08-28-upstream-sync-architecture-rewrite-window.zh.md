# Agent Note: 2026-08-28 上游同步——架构重写窗口

Status: implemented

[English](2026-08-28-upstream-sync-architecture-rewrite-window.md) | 中文

## Problem

完成 2026-08-18 → 2026-08-28 的上游同步（`daypaw-sync/2026-08-28`，上游 `deepseek-ai/deepseek-harness@cd5ef81481`）恰好撞上上游的 client 架构重写：apiproxy 包整体退役（Typert 迁移完成）、`dsh-client-runtime` 拆分、顶层 `examples/` 退役、交互模型从 mux/rpcId 重写为 Remote Event 瀑布 + 声明合并 StandardProps。fork 壳线（#54–#62）建立在旧架构上，因此 49 个冲突文件、约 100 处测试类型错误、5 个组装快照文件都需要移植而非合并。

## Decision

- **依赖面**：apiproxy → `dsh-api-{session,settings,workspace}-controller`；`dsh-client-runtime` → `dsh-client-store` + `dsh-api-session-controller` + `dsh-client-ui-session`；`dsh-client-web-react` → `dsh-client-ui-renderer`/`dsh-client-test-runtime`；`dsh-acp-snapshot` → `dsh-session-snapshot`；`dsh-client-runtime/client` 的 32 处导入全部重映射。
- **fork UI 壳线移植**（#54–#62 全部代码面）：`ctx.slots` → ui-renderer；会话标准件 → `useChat`/`useSession`/`useSessionPendingInteraction`（声明合并）；pending 审批 → ui-approval 的 `PendingApproval` 类（`answer()` 通道）；`IApiClient` → `ctx.remote` 命名空间（含子路径 inject）；`host.describe` → `session/modelCatalog`；`agentPreset` 行字段退役；conversation 座位 session-maybe → session 域。
- **fixture.ts 重写**：上游 mux 模型 → Remote Event 瀑布模型；fork 的 `durable/*` 端点、审批历史投影、turn-75 配对全部在新架构重放（`fixture-durable.client.spec.ts` 改走 control 流）。
- **web-app roster**：删除 storage 族/session-projection-cache/client-runtime/api-gateway；新增 session-reference/file-reference-local/subagent-model-selection-settings/三 controller/ui-renderer/ui-session/ui-approval/ui-chat。
- **skeleton 迁移**：`examples/daypaw-skeleton` → `packages/examples/daypaw-skeleton`（上游 examples 新家），补 `src/index.ts`（`createSkeletonWorkflow` 工厂）、invariant 配套、tsdown 构建纳入。
- **组装快照 harness 重写**：`apps/daypaw-web/tests/assembled-boot.ts` 镜像上游新协议（WebBootGraph + bootInjections + bootstrap batch），PLUGINS 从 bundle patch 自动派生；5 个 golden 刷新。
- **文档**：doc-sync 全链绿（2026-08-28 配对规则收紧——687 个 zh note 补 switcher/链接对齐、fork 语料排除入 manifest、生成文档 zh 同步、AGENTS 预算 1975→1990）。
- **hygiene**：rescope-vendor 移除 6 条被上游吸收的 EXACT_EDITS 并新增 inspector 豁免；verify-application-entrypoints 登记 fork CLI 例外；skeleton 与 fork README frontmatter 全套合规。

## Alternatives considered

- **分批小步 sync**：上游该窗口的破坏面（client 架构重写）无法拆分——单次 merge 必然整体面对；分批只会把移植工作摊到多轮且每轮都红。
- **冻结上游基线**（ADR 0001 已否决）：与「保持 merge 可能性」矛盾，且吃不到 dev-preview 的密集修复。

## Consequences

- fork UI 壳线现已骑在新上游 client 架构上；后续该区域的 sync 是增量而非移植规模。
- #64 的 `ensureSymlink` core touch 消解（上游重写 heal 面；fork 只消费公开的 `healProfilesModuleFallback`）。
- 已知环境性基线红（非本 sync 引入）：`packages/session/session-projection-cache/tests/cache.spec.ts`（cold-read 与 write-policy 用例）在 node 26 下偶发失败——在同步 commit 的纯上游 worktree 复现（3 跑 2 红），node 23.11 与 CI 的 node 24 下绿。`hooks/*`、`bash-sandbox/partial-landlock`、`hmr-config`、`gen-third-party-notices`、`oxlint-contract` 等 spec 在全量并发下亦偶发；单独运行与 CI 矩阵均绿。
- 后续：生成文档 zh 更新继续走标准双语流程（`dsh-translate-docs` 需显式调用）。
