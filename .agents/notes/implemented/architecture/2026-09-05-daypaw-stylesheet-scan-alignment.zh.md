# Agent Note：daypaw CSS 通过上游 stylesheet-scan

Status: implemented

[English](2026-09-05-daypaw-stylesheet-scan-alignment.md) | 中文

## Problem

上游提交 `7020c7e122`（2026-08-28 checkpoint..master 同步窗内）在 `ui-theme/tests` 落了 repo 级 stylesheet 契约 spec，遍历 `packages/` 下所有 CSS 文件：每个全圆 `border-radius` 须在同规则内配对 `corner-shape: round`；任何规则不得把 lv/elevation 投影与中性 border token 描边并置；中性 token 实线描边一律 0.5px；border token 填充的分隔线一律 0.5px；`--dsh-scrollbar-*` 重绑须成对，且每个在抬升面上滚动的 sheet 须绑完整 l2 对。扫描根含 `packages/daypaw`，而 sync 不会重写它——gate 落地即在 fork 自营样式上红，且合并侧无处可修。

## Decision

daypaw 的 CSS Modules 满足这些 spec。状态在 spec 抵达本树之前即被验证：把上游自己的 spec 文件（连同领先本树的 `corner-shape.css`、`design-platform.css`、`gradient-shadow-text.css`，未提交地铺在上游路径上）跑过本 checkout——每份 repo 级失败清单中 daypaw 条目为零。转换沿用上游 sweep 的补偿映射——四面卡片盒 l2→l4、交互控件与表单字段 l2→l3、分隔线保持 l2——共 15 处中性实线描边；两处全圆角（`InboxNav` `.iconButton`、`settings-page` `.warningDot`）配上 `corner-shape: round`。`agents-page` `.card:hover` 加深为 `--dsw-alias-label-dimmed`（上游 l4 静息卡片的悬停目标）；l3 悬停描边会比 l4 静息描边更浅。daypaw 没有规则把抬升投影与中性描边并置、也没有 1px 填充分隔线，且每个在抬升面上滚动的 sheet 本就带完整 l2 重绑对——这些规则原样通过。

品牌层（[shell brand theme](../feature/2026-08-27-daypaw-shell-brand-theme.zh.md)）按构造在扫描范围外：它是 TS token 覆盖表而非磁盘 CSS，且 `--dsw-alias-scrollbar-*` 全集与 border 阶梯按 scheme 各自完整，故无需改动。描边粗细与圆角配对是壳所复用的上游视觉语言，不是品牌身份——品牌认领的是色板与密度（spec 05 §7），没有任何 fork 记录把身份押在 1px 描边上——因此 [#88](https://github.com/0xnicholas/daypaw-pro/issues/88) 的品牌冲突待裁清单为空，「提请上游收窄扫描范围」的升级路径未启用。

## Alternatives considered

- **sync 时再修** —— 拒绝：spec 随 sync 落地，红的扫描会卡住 sync 的 gate 重放；在上游文件到达之前镜像 sweep，比在其之下补修便宜。
- **保留 1px 描边作为 fork 品牌、请上游对 `packages/daypaw` 豁免扫描** —— 拒绝：品牌层认领色彩与密度而非描边粗细；豁免会把壳刻意复用的视觉语言切成两套。
- **所有转换一律加深到 l4** —— 拒绝：上游 sweep 按面型补偿（卡片 l4、控件与输入 l3、分隔线保持原级）；一律 l4 会让分隔线与控件过浓。

## Consequences

fork 壳即刻渲染 0.5px 发丝线、真圆保持正圆，先于 sync；sync 落地后，新的 ui-theme spec 对 `packages/daypaw` 直接通过，无需合并侧 CSS 修补。0.5px 暖色分隔线（品牌 l2 色调减半宽）是唯一值得在运行壳里目验的面——与上游 sweep 后的自家观感一致，且对 border 阶梯 alpha 的值级品牌微调仍然可行，不必触碰本契约。代价：补偿映射自此成为 sync 跟随义务——上游若再调级别，daypaw 的镜像会静默漂移，直到某条扫描规则破——随 sync 到达的 spec 即是绊线。

## Verification

harness（上游 `tests/stylesheet-scan.ts` 加三个 spec 文件，置于上游路径）经 vitest 跑过本树：每份 repo 级失败清单的 `packages/daypaw` 条目为零——修复前为 17 条（15 条粗描边、2 个未配对圆），修复后为 0。harness 本身不提交：sync 会带来真 spec，自那时起对 `packages/daypaw` 如对任何目录一样生效。该次运行中余下的失败全部位于上游自营包——它们的 pre-sweep 副本会被 sync 整体替换。
