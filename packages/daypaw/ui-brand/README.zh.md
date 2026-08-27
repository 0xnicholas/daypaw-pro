# @daypaw/ui-brand

[English](README.md) | 中文

daypaw 品牌主题插件：一个只做一件事的 fork 客户端 UI 插件——经 `ctx.theme.overrideTokens` 把品牌 token 层叠到整包复用的 [`ui-theme`](../../client/ui-theme/README.md) 基座上。它落实 [docs/spec/05-product-shell.md](../../../docs/spec/05-product-shell.md) §7 的视觉品牌裁决（[裁决 #48](https://github.com/0xnicholas/daypaw-pro/issues/48)）：暖橙 accent、暖中性底、「帮手的桌面」而非「运维控制台」、单一中偏低密度——与上游 dev 壳一眼可区分。

该层（[`brand-tokens.ts`](./src/client/brand-tokens.ts)）是品牌色值与间距值的唯一家：

- **色彩对**（50 个 `--dsw-alias-*`／`--dsw-specific-*` 覆盖）把复用的语义 token 重指到暖象牙／烤棕阶梯与爪橙色 accent。上游静态尺度（`--dsw-static-*`）原样不动——其他主题仍可在其上组合——而明暗偏好继续驱动基座调色板：theme 服务按当前 scheme 折叠该层，切换即重选 leg，从不重注册。
- **密度尺度**（8 个 scheme 无关的 `--dp-space-*` 档位，2–24px）承载 §7 的中偏低节奏。`--dp-*` 是 fork 的 token 前缀；`--dsw-*` 命名空间仍归上游所有。fork 组件的 CSS Module 只引用这些 token 与 `--dsw-alias-*`／`--dsw-specific-*` 名——组件样式表里不落任何裸色值或间距值。

文字标本身（导航列的 `daypaw` 一词）属 [`@daypaw/ui-inbox`](../ui-inbox/README.md)；本插件经 `--dsw-alias-brand-text` 为它上橙色。

亮色调色板是产品默认。该默认住在 `ui-theme` 的 `DEFAULT_PREFERENCE`（`system` → `light`，本次工作唯一登记的上游 core touch，[#61](https://github.com/0xnicholas/daypaw-pro/issues/61)）；偏好本身——浅色/深色/跟随系统——经设置页的主题行（[`@daypaw/ui-settings`](../ui-settings/README.md)）切换。

## Model Experience

### Brand token layer

#### What the model sees

无。该插件唯一的调用是 `ctx.theme.overrideTokens`；只贡献 CSS 自定义属性值（`--dsw-alias-brand-primary` 等），不存在 prompt、工具或 schema 面——token 值永不进入模型请求。

#### Token effect

零 live-request token。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **插件前引导区间走基座调色板。** 宿主注入的引导脚本在插件树加载前设置 `color-scheme` 与暗色属性；品牌 token 值在客户端树激活后生效（加载微光两端都中性）。
- **accent 对比度是调出来的，不是算出来的。** 橙色 leg 按其填充/墨色配对手工选定 ≥4.5:1；未来调色板修订若移动数值，应重检两个 scheme。
- **密度不可由用户调节。** spec 05 §7 定案单一密度；在 `--dp-space-*` 值成为可换层之前，偏好旋钮需要自己的裁决（以及一行设置）。
