# @daypaw/ui-brand

English | [中文](README.zh.md)

The daypaw brand theme, a fork client UI plugin with exactly one effect: stacking the brand token layer onto the reused [`ui-theme`](../../client/ui-theme/README.md) base through `ctx.theme.overrideTokens`. It implements the visual-brand ruling of [docs/spec/05-product-shell.md](../../../docs/spec/05-product-shell.md) §7 (ruling [#48](https://github.com/0xnicholas/daypaw-pro/issues/48)): warm-orange accent, warm-neutral base, 「帮手的桌面」 rather than 「运维控制台」, one fixed medium-low density — visibly distinct from the upstream dev shell at a glance.

The layer ([`brand-tokens.ts`](./src/client/brand-tokens.ts)) is the single home for brand color and spacing values:

- **Color pairs** (50 `--dsw-alias-*`/`--dsw-specific-*` overrides) re-point the reused semantic tokens at a warm ivory/roasted-brown ramp with a paw-orange accent. The upstream static scale (`--dsw-static-*`) stays untouched — other themes still compose over it — and the light/dark preference keeps driving the base palettes: the theme service folds the layer per active scheme, so switching re-picks the leg, never re-registers.
- **Density scale** (8 scheme-invariant `--dp-space-*` steps, 2–24px) carries spec §7's medium-low rhythm. `--dp-*` is the fork's token prefix; the `--dsw-*` namespace stays upstream-owned. The fork components' CSS Modules reference these tokens and `--dsw-alias-*`/`--dsw-specific-*` names only — no raw color or spacing values sit in component stylesheets.

The wordmark itself (the nav column's `daypaw` text) is [`@daypaw/ui-inbox`](../ui-inbox/README.md)'s; this package gives it its orange through `--dsw-alias-brand-text`.

The light palette is the product default. That default lives in `ui-theme`'s `DEFAULT_PREFERENCE` (flipped `system` → `light` as the one registered upstream core touch of this work, [#61](https://github.com/0xnicholas/daypaw-pro/issues/61)); the preference itself — light/dark/system — is switched from the settings page's 主题 row ([`@daypaw/ui-settings`](../ui-settings/README.md)).

## Model Experience

### Brand token layer

#### What the model sees

Nothing. The plugin's only call is `ctx.theme.overrideTokens`; it contributes CSS custom-property values (`--dsw-alias-brand-primary` and friends), and no prompt, tool, or schema surface exists — token values never reach a model request.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The pre-plugin boot interval rides the base palette.** The host-injected bootstrap script sets `color-scheme` and the dark attribute before the plugin tree loads; brand token values apply once the client tree activates (the loading shimmer is neutral either way).
- **Accent contrast is tuned, not computed.** The orange legs were picked for ≥4.5:1 on their fill/ink pairs by hand; a future palette revision should re-check both schemes if values move.
- **Density is not user-adjustable.** Spec 05 §7 fixed one density; a preference knob would need its own ruling (and a settings row) before the `--dp-space-*` values become a swappable layer.
