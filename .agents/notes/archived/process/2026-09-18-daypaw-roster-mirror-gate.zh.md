# Agent Note: daypaw roster 镜像门

Status: implemented
Archived: 2026-09-26

[English](2026-09-18-daypaw-roster-mirror-gate.md) | 中文

## 问题

fork 的浏览器面是一份组合镜像:`packages/daypaw/web-app/cordis.patch.yml` 由 `packages/bundle/web-app/cordis.patch.yml` 派生——上游行保留、有意裁剪、fork 自有行追加。这条镜像律有一个执行属主：`verify-cordis-config`。此门之前它只活在 patch 注释与 sync 仪式内对两份 ~470 行 yml 的人工 diff 里——该 diff 已反复证明不够。三类事故证明人工 diff 不够:2026-09-13 sync 漏收 `resources`/`ui-sidebar-right` 两个供主行,浏览器 boot 整周期红,直到 [#93](https://github.com/0xnicholas/daypaw-pro/issues/93) 补金样才暴露;`workspace-files` 行直到 release 冒烟才现形(CORE_TOUCHES 有案);而 `ui-deliverables` 行缺失根本不失败——供主行齐备时 roster 行照常解析，缺席不产生失败或诊断。[组装 golden 车道](../testing/2026-09-14-daypaw-golden-lane-required.zh.md)只盖激活面(缺席致 boot 断);静默缺席此前无探测器。

## 决策

- 镜像律落进 `verify-cordis-config`——不新建脚本、零 `run-gates.ts` 改动;本就携带该门的三条聚合(ci / hygiene / ciSharedStaticGates)自动覆盖。`docs/fork/CORE_TOUCHES.md` 登记该扩展为可提。
- 比较键 = 包名:上游行其包在 workspace manifest 声明 `dsh.client` 者,必须出现在 fork roster 或 `ROSTER_TRIMS`(门脚本内 const 数组,逐项行尾理由注释)之中。初始裁剪集五行:`ui-open-in-app`(壳不装 Open-In 分裂按钮)、`ui-sidebar`(`@daypaw/ui-inbox` 整体替换)、`ui-sidebar-documentpreview` 与 `ui-sidebar-files`(右侧栏两 tab 未装)、`ui-brand-official`(`@daypaw/ui-brand` 占品牌席)。
- host 行不比较:config 覆盖、disable、以及 `open-in-app`/`subagent-model-selection-settings` 一类的缺席是 patch 层语义,不是 roster 成员资格。
- 裁剪项对应的上游行消失时对称判红,清单无法跨 sync 腐烂。
- 检查本体是导出的纯函数 `rosterMirrorViolations(upstream, fork, trims)`;`verify-cordis-config.spec.ts` 盖四个方向(上游加行 / fork 删行 / 残项 / 全绿),接线面在活树上逐分支验红。

## 备选方案

**按整行(id + name + config)而非包名比较。** 否决:id 改名与 config 分歧是合法 patch 语义——fork 有意覆盖 config、禁用行;决定客户端半边是否抵达浏览器的只有 roster 成员资格。

**裁剪清单留在 yml 注释或 sidecar 清单里。** 否决:注释正是裁剪行此前无人评判的居所;逐项理由的 const 就住在 `verify-cordis-config` 里、紧挨它所喂的比较，残项判红。

**新建脚本挂进 run-gates。** 否决:`verify-cordis-config` 已收集 patch 插件引用、workspace manifests 与 yaml loader;第二个家只会分裂组合检查,零新增覆盖还要多一行聚合。

**改为扩展 golden 车道,boot 时探测 roster。** 作为替代否决:boot 探测只看得见破坏激活的缺席——`ui-deliverables` 形一类永远隐身。golden 车道仍是互补的激活面。

## 后果

- 覆盖面闭合:sync 漏收或未拾取上游 client 行,`verify-cordis-config` 即红,指名该行与两条出路(镜像之,或带理由记入裁剪)。与 golden 车道(激活面)、release 冒烟(依赖闭包面)合拢,2026-09-13 sync 的三类事故全有指名探测器。
- fork 自有 client 行仍须手工加 roster 行——镜像律只约束上游行;daypaw cookbook §2 现已点名 ui-* 包的两个追加登记步骤(roster 行 + web-app 依赖行)及其各自的门。
- host 行缺席按设计不查;若某保留行日后硬等待 fork 裁剪掉的供主行服务,golden 车道会捉住那次 boot 断裂。
