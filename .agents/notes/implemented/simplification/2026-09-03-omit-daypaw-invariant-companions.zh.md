# Agent Note: 按上游口径裁掉 daypaw invariant companion

Status: implemented

[English](2026-09-03-omit-daypaw-invariant-companions.md) | 中文

## 问题

每个 fork 自营包都发布过一个 `src/invariant.ts` companion——installer 为空、靠注释说明理由：`packages/daypaw/` 下十一个，外加 `daypaw-skeleton-example`。上游提交 `15f2997bcb` 已把该形态判为反模式并删除 207 个「带解释的空壳」：companion 只有在能对照「可能独立分歧的观测」时才配发布（跨事件协议、事件对权威可变状态、多生产者拼装、他处消费的 durable 数据），而服务存在性、插件效果或纯包理由永远不够格。wayfinder #80 裁决 2 采纳该口径，并要求下次 sync 前完成 fork 侧审计。

## 决策

- **审计结论：无一够格，十二个 companion 全数移除。** 各包理由移入其 README 作为受 gate 校验的缺席句（`**Runtime invariant:** No companion is published. …`），逐包具体：`engine` 刻意无 Cordis（无可挂事件流；状态机由故障注入套件断言）、`store` 只有数据形状、`sdk` 与 `cli` 无自有状态（状态机在闭包内）、`approval-history` 的折叠在投影注册表处校验且事件关系归 dsh-user-approval、五个 `ui-*` 插件是纯表现层由各自 spec 断言、`web-app` 的贡献随 fiber 由各注册表拆卸且关系归注册表所在包、skeleton demo 无独立观测。
- **源码与全部发布 wiring 一并移除**：`./invariant` 导出、`lib/invariant.js` files 条目、dsh-invariants peer/dev 依赖（`@daypaw/cli` 闭包 `dependencies` 条目保留，直至闭包成员自身 peer 退役）、TypeScript 项目引用、五个 `ui-*` tsdown 条目、五个注册 spec，以及 `tsconfig.base.json` 的 `@daypaw/*/invariant` 映射。
- **共享 gate 即刻采纳上游条件化形态**：`package-invariants` 接受带 README 理由的无 companion 包、拒绝缺席后残留的导出/发布/构建 wiring；`verify-built-package-invariants`、Vitest 宿主（`test-invariants.ts`）与 `check-workspace-constraints` 对缺席包跳过。仅存一条过渡 fork 差异至下次 sync：gate 仍接受带 `No runtime invariant:` 标记的空 installer——本 checkpoint 的前清洗上游树还发布着 208 个；上游自己的 gate 版本会连同 companion 一起删掉该分支。ADR 0007 §2（companion 硬约定）与 ADR 0011 sdk peer 补记相应修订，release 脚本的 `SDK_EXTERNAL_PEERS` 与 sdk 冒烟消费方也去掉退役的 dsh-invariants peer。

## 否决的替代方案

- **给 companion 写真检查后保留。** 否决：没有任何 fork 包拥有「观测可独立分歧」的关系；硬写检查只会复述 spec 或自证自探——恰是上游点名的反模式。
- **等 sync 被动消化约定漂移。** 否决：裁决要求 fork 侧在 sync 前了结，sync 不携带 daypaw 决策；整体合并还会让 `@daypaw/*` wiring 撞上更严的新 gate。
- **即刻全量移植严格 gate（处处拒绝空 installer）。** 否决：会让本 checkpoint 里 208 个前清洗上游自有空壳全部失败，逼着在上游自有包上抢跑重写。

## 后果

- fork 包不再有 companion 源码、导出、依赖、引用、构建条目或注册测试；README 持有缺席理由，gate 强制其存在与逐包具体性。
- daypaw 包测试只挂 invariant 服务；穷举拓扑测试仍挂载树内全部已发布 companion。
- 当某个 fork 包日后长出够格关系（例如跨事件生命周期或 durable 投影），companion 带真检查与负例测试回归，README 句子随之替换——对齐上游的重引入条件。
- 下次 sync 以上游 gate 版本删除过渡标记分支；`scripts/package-invariants.ts` 的 CORE_TOUCHES 行已记明该差异在彼处消解。
