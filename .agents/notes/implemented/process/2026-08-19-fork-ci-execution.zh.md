# Agent Note: fork CI 执行——落地成形的 linux 主门

Status: implemented

[English](2026-08-19-fork-ci-execution.md) | 中文

## 问题

ADR 0007 §5 裁决了 fork 的 CI 姿态——继承重车道用 repo 设置禁用、保留 test / coverage / snapshot / typecheck / lint 的 linux 主门、fork 特有的门以纯新增 workflow 文件添加——但执行事实当时未知：每次 push `main` 都在继承的 `E2E (real DeepSeek API)` preflight 上失败（该工作流无 `DEEPSEEK_API_KEY_EXTERNAL` 秘密即 fail-loud，且带每晚 schedule），每次 issue 事件都在 `Issue lifecycle` 上失败（其 `create-github-app-token` 步骤需要上游的 GitHub App，fork 永远不会有），而「保留」的主门 `ci.yml` 从未跑过。

## 决策

- **`ci.yml` 无法服务 fork，保持不动。** 其实质矩阵 job 全是 `pull_request` 条件，解析到企业规格标签 runner（`dsh-ubuntu-24-04-16core`、`dsh-windows-2025-16core`）或自建 failover 池——fork 没有这些基建；其 push 面只有 master 条件的自建池 drill 与 `if: false` 车道。往 push 过滤加 `main` 只会触发一次无内容的 run，对它的零 core-touch 姿态维持不变。
- **主门以 `daypaw-gate.yml` 落地** —— 纯新增的 fork 自有工作流，push `main`（外加 `pull_request` / `workflow_dispatch`）触发：不可变安装、`typecheck`、`lint`、`test:coverage`（CI 覆盖率门，而非裸 `test`）、`test:snapshot`（无 `DSH_SNAPSHOT` 时默认 replay，CI 永不写期望输出）。标准 `ubuntu-latest`、node 24、`DSH_TELEMETRY_DISABLED: '1'`。
- **十二条继承工作流在 repo 设置中禁用**（可逆、零文件改动）：`e2e`、`issue-lifecycle`（两个正在失败的），加上教义点名或基建耦合的重车道 `docs-pages`、`e2b-e2e`、`pi-ai-provider-e2e`、`landlock-run`、`landlock-run-release`、`python-release`、`release-vendor`、`release`、`build-exe-for-python-sdk`、`sandbox`。保持启用：`ci.yml`（无 PR 或 master push 即惰性；教义保留之）、`issue-policy` 与 `expected-filenames`（仅 pull_request，直推仓库里惰性）、Dependabot。
- **真 API e2e 留在本地。** 配置 key 秘密以解救 `e2e` 被否决：测试政策把真验证留在本地、keyless CI 保持绿；带 key 车道还会让每次 push 与每晚 schedule 都计费。

## 曾考虑的替代方案

- **配置 `DEEPSEEK_API_KEY_EXTERNAL` 保留 `e2e`** —— 否决：把每次 push 和每晚运行变成计费的真 API 调用；fork 的验证契约是 keyless 门 + 本地 with-key 运行。
- **core-touch `ci.yml` 加 `main`** —— 否决：push 面只有 master 条件的 drill；fork 想要的矩阵是 pull_request 条件、跑在 fork 没有的 runner 上。该编辑只会触发空 run 并白付一笔 core touch 登记。
- **连 `ci.yml` 一起禁用** —— 否决：ADR 0007 保留它；它在 `main` push 上惰性，fork 哪天开 PR 也无害（那还需要上游的 runner 标签，所以直推仍是工作流）。

## 后果

- push `main` 得到一次 keyless 门运行（typecheck、lint、覆盖率、快照），取代必失败的 E2E；issue 事件不再触发 `Issue lifecycle`。
- 每次 push 的 Actions 分钟成本 = 一个标准 runner job（约 15–30 分钟，覆盖率占大头）；每晚 E2E 燃烧消失。
- 同步仪式对这条的重放是 repo 设置——每次上游 merge 后，在 Settings → Actions 复核禁用清单并确认 `daypaw-gate.yml` 在位（文件，merge 无冲突）。
- fork 若改走 PR 流，`daypaw-gate.yml` 已覆盖 `pull_request`；`ci.yml` 矩阵仍需上游 runner 标签，维持界外。
