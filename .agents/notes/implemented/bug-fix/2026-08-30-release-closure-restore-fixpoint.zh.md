# Agent Note: 发布闭包恢复收敛到不动点

Status: implemented

[English](2026-08-30-release-closure-restore-fixpoint.md) | 中文

## Problem

自 2026-08-28 上游同步起，`Release (daypaw)` 的 pack 作业以 `closure still incomplete after restore rounds: vfile-message` 失败。同步把 shiki/micromark/vfile 渲染栈拖进 CLI 闭包，最深依赖链达七层（最底为 `vfile` → `vfile-message`）。`completeClosure` 在固定的六轮预算下每轮只暂存一个依赖深度层，最后一层从未被尝试，发布以预算错误而非打包错误失败。

## Decision

- 恢复循环运行到 `missingClosurePackages` 返回空集为止，没有轮数预算。每轮至少暂存一个包，每个已暂存的包在下一次检查中按其暂存目录入账，且仓库有限的磁盘源界定了可达包名全集，循环在不动点终止。
- 闭包逻辑从 `scripts/release/daypaw.ts` 移至 `scripts/release/daypaw-closure.ts`（`missingClosurePackages`、`locatePackage`、`findWorkspacePackage`、暂存 manifest IO），仓库根改为显式参数，恢复行为由此获得单测接缝。`daypaw-closure.spec.ts` 钉住：深于任何固定预算的链能完成；无仓库源的包按名称使发布响亮失败；可选 peer 与消费方自供的外部 peer 允许缺席；已暂存的包按目录入账——即使残留 manifest 声明的是另一个名字，与 Node 的目录解析一致。
- 其余失败模式不变：任何源都供不出的包按名失败，畸形暂存 manifest 在完整性 BFS 中失败。

## Alternatives considered

**调高轮数预算。** 否决：任何固定深度都会在下一条更深的链上再失败；链深是同步后的依赖图属性，不是发布的属性。

**一次性从源预解析完整传递闭包。** 否决：用第二套解析算法替换三行循环，而轮循环已经在 tarball 实际携带的暂存 manifest 图上收敛。

## Consequences

- CLI 闭包经七轮恢复完成（593 个捆绑闭包 manifest），SDK 两轮；发布车道无需工作流改动。
- 外部恢复源经根解析路径解析，在 tsx 之下这些路径包含 pnpm 的隐藏提升存储 `node_modules/.pnpm/node_modules`。用纯 Node 跑发布脚本看不到该存储，会逐外部包以 `no repository source` 失败；发布车道始终经 tsx 调用。
- 本地跑 `pnpm deploy --legacy` 后，pnpm 的运行前依赖检查会要求交互式清除 modules 目录；一次普通 `pnpm install` 即恢复开发树（既有行为，未改动）。
