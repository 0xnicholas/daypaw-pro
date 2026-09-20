# Agent Note: 上游同步至 0.1.5-rc.2 —— 移植危险点与修复

Status: implemented

[English](2026-09-13-upstream-sync-0-1-5.md) | 中文

## 问题

2026-09-13 同步合并了 1301 个上游提交(0.1.3-alpha.1 → 0.1.5-rc.2)。有四个移植危险点无法归约为冲突解决:每一个都会让树保持绿而某个运行时面坏掉,未来同步必须一眼认出它们。

## 决策

**归档笔记是 rename 嫁接目标。** Git 的 rename 检测把本 fork 对某 `implemented/` 笔记的编辑合并进了上游归档(冻结)副本,改变了密封内容。任何同步若发现归档笔记与上游不同,恢复上游 blob;活知识属于持有它的脚本或新笔记,绝不属于冻结孪生。

**自含前门必须显式调用 `runCli()`。** 上游 dsh bin 现以 `import.meta.main` 守卫自执行,于是 `@daypaw/cli` 的 `bin.mjs` —— 先播种 profile、改写 argv、再 import dsh bin —— 除非调用导出的 `runCli`,否则静默 exit 0。打包 CLI 冒烟零输出退出是这道守卫,不是组合死了。

**npm 闭包漂移在 fork patch 之前。** release 从 registry 补齐缺失闭包,即使 fork 树钉着旧语义,上游最新发布的运行时也会搭上 tarball。获得新服务依赖的上游新行(本次:`ui-deliverables` 等待 `workspaceFiles`)必须在同一次同步里于 `packages/daypaw/web-app/cordis.patch.yml` 补上供主行;上游自己的 web bundle 是「一个服务需要哪些行」的参照。

**金样命名跟随 corpus 契约。** `SESSION_FORMAT_VERSION` 前进时,滚版后的属主本地金样随写入面更名(`session.v2.jsonl` → `session.v3.jsonl`);corpus spec 对文件名/头部代数不匹配的失败先于任何回放发生。

槽位迁移骑在声明包的契约上:global-main-panels 重构下 `conversation` → `main.conversation`(ui-conversation)、`details` → `rightbar.session`(ui-sidebar-right),影子注册者对外来契约取 project reference 并以 `import type {} from '<pkg>/client'` 合并。

## 备选方案

**把每个危险点当作一次性冲突修复。** 四者全都让树保持绿;只有命名过的危险点能让下一次同步在重新从静默退出推导之前认出失败类别。

**从 daypaw 组合排除上游新行而非补其供主。** 排行使 web 面偏离上游 bundle 对等,且排除清单每次同步都会增长;挂供主行使 daypaw 保持上游 bundle 行集的镜像。

## 后果

同步验证必须包含打包 CLI 冒烟(`CI=true pnpm run release:daypaw`),因为四个危险点中的三个只在打包闭包或自含 bin 中显形。release 脚本文档所载的 deploy 残留使本地两次 release 之间必须干净 `pnpm install`。`scripts/release/daypaw.ts` 拥有冒烟;`docs/fork/CORE_TOUCHES.md` 拥有本次同步新增与取代的登记行。
