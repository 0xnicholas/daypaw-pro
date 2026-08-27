# Agent Note: daypaw 壳品牌主题——叠在复用 ui-theme 基座上的一层暖色 token

Status: implemented

[English](2026-08-27-daypaw-shell-brand-theme.md) | 中文

## Problem

spec 05 §7（裁决 [#48](https://github.com/0xnicholas/daypaw-pro/issues/48)）定了产品壳的视觉品牌：daypaw 文字标、暖橙 accent 叠暖中性底（「帮手的桌面」，与上游 dev 壳一眼可区分）、单一中偏低密度、亮色调色板开箱默认、暗色经既有 `ui-theme` 偏好可达。壳整包组合 `ui-theme`，因此这项工作要在不 fork 主题机制的前提下回答两个问题：品牌值住在哪里才能不让任何硬编码色值或间距散进组件；「亮主题默认」如何与上游 `DEFAULT_PREFERENCE: 'system'` 相容。

## Decision

- **品牌 = 一层 token 覆盖。** 新 fork 客户端插件 `@daypaw/ui-brand`（`packages/daypaw/ui-brand`）只有一个效果：在 `ctx.effect` 下 `ctx.theme.overrideTokens('daypaw/ui-brand', BRAND_TOKEN_OVERRIDES)`。映射表携带 50 组色彩对（暖象牙／烤棕阶梯、爪橙 accent——填充色与其墨色对比 ≥4.5:1）与 8 个 scheme 无关的密度档位。theme 服务拥有叠层、按 scheme 折叠与拆除；切换偏好只是重选该层的 leg、从不重注册——复用栈渲染的每个面（primitives、markdown、滚动条、菜单）随之整体换肤，上游样式零改动。
- **fork 铸造的 token 带 `--dp-` 前缀。** 密度尺度为 `--dp-space-0..7`（2–24px）；`--dsw-*` 仍归上游所有。四个 fork UI 包的 CSS Module 现在只经这些 token 引用间距（离档值向上取整：10→12、14→16、18→20——spec §7 把精确间距值定为实施期工作）；色彩本就只走别名。`brand-tokens.ts` 是品牌裸值的唯一家。
- **亮默认是本工作唯一的上游 core touch。** `ui-theme` 的 `DEFAULT_PREFERENCE` 由 `'system'` 翻为 `'light'`（AppearanceRow store 的 init 一并改读常量），登记于 [CORE_TOUCHES.md](../../../../docs/fork/CORE_TOUCHES.md)。ADR 0001 阶梯在此之前穷尽：settings namespace 属主注册（第二次 `register` 抛错，fork 加不了 `base` 层）、插件没有 config 钮、把 `preference: 'light'` 种进 `$DSH_HOME/settings.yaml` 会写下用户从未做过的选择覆盖，且该文档与 dsh CLI 共享。
- **主题行落地、密度行移除。** 通用分区的主题占位变成经 `ctx.theme` 的 light/dark/system 下拉（apply 闭包镜像 store 走页面 hooks 通道，写入走服务唯一写入口）。密度占位行删除：§7 定案单一密度，「即将上线」背后没有东西可上线；尺度改由品牌层承载。
- **文字标归其所有者。** ui-inbox 本就渲染 `daypaw` 一词；该层经 `--dsw-alias-brand-text` 为它上色。改名维持裁决的 token 级改动。

## Alternatives considered

- **`theme.register()` 一个可选的 daypaw 主题**——否决：品牌是壳的样貌，不是用户可选的附加项；注册式主题会让内置 light/dark 被选中时失去品牌，且第三方注册 id 依设计只留在进程内。
- **以品牌 bundle 内的 CSS 文件承载密度尺度**——否决：品牌值将住在两个家（样式表 + 主题层）；覆盖层保住唯一来源、在组件绘制前生效、在 jsdom 车道可断言、并随插件 fiber 拆除。
- **铸造 `--dsw-alias-space-*` 名**——否决：`--dsw-*` 命名空间归上游；上游日后铸造同名不同值会在下一次 sync 相撞。
- **首跑把持久偏好种成 light**——否决：写下用户从未做过的用户层覆盖，写进与 dsh CLI 共享的 settings 文档，并与浏览器首次读取竞态。
- **经 `settings.general.item` 槽复用上游 AppearanceRow**——否决：该槽承载休眠的上游 General 生态；渲染它会把 dev 壳的行拽进 fork 页面。fork 行改为镜像语言行的下拉形状。

## Consequences

壳在两个调色板下都渲染暖底暖橙、处处亮色启动、经持久偏好切换；组装道 `brand-theme` golden 钉住全链（启动 token、行驱动的暗色翻转、无媒体查询环境下 `system` 解析回亮色、间距的 scheme 无关性）。代价：`DEFAULT_PREFERENCE` 触碰同时改变上游 dsh web 壳的默认，且每次 sync 需重放；插件前的引导区间走基座调色板（加载微光两端中性）；未来调色板或密度修订是单文件内手工核对的对比度编辑，而非可计算的尺度。
