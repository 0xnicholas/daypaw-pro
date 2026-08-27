# Agent Note: daypaw shell brand theme — one warm token layer over the reused ui-theme base

Status: implemented

English | [中文](2026-08-27-daypaw-shell-brand-theme.zh.md)

## Problem

Spec 05 §7 (ruling [#48](https://github.com/0xnicholas/daypaw-pro/issues/48)) ruled the product shell's visual brand: the daypaw wordmark, a warm-orange accent over a warm-neutral base (「帮手的桌面」, distinguishable from the upstream dev shell at a glance), one medium-low density, light palette as the out-of-box default, dark reachable through the existing `ui-theme` preference. The shell composes `ui-theme` wholesale, so the work had to answer two questions without forking the theme mechanism: where do brand values live so nothing scatters hardcoded colors or spacing into components, and how does "light default" square with upstream's `DEFAULT_PREFERENCE: 'system'`?

## Decision

- **The brand is one token-override layer.** The new fork client plugin `@daypaw/ui-brand` (`packages/daypaw/ui-brand`) has exactly one effect: `ctx.theme.overrideTokens('daypaw/ui-brand', BRAND_TOKEN_OVERRIDES)` under `ctx.effect`. The map carries 50 color pairs (warm ivory/roasted-brown ramps, paw-orange accent — fills ≥4.5:1 against their ink) and 8 scheme-invariant density steps. The theme service owns stacking, per-scheme folding, and teardown; switching the preference re-picks the layer's leg, never re-registers, so every surface the reused stack renders (primitives, markdown, scrollbars, menus) rebrands with zero upstream style edits.
- **Fork-minted tokens carry the `--dp-` prefix.** The density scale is `--dp-space-0..7` (2–24px); `--dsw-*` stays upstream-owned. All four fork UI packages' CSS Modules now reference spacing only through these tokens (off-scale values snapped upward: 10→12, 14→16, 18→20 — spec §7 makes exact spacing implementation-time work); colors were already alias-only. `brand-tokens.ts` is the single home for raw brand values.
- **Light default is the work's one upstream core touch.** `DEFAULT_PREFERENCE` flipped `'system'` → `'light'` in `ui-theme` (with the AppearanceRow store's init now reading the constant), registered in [CORE_TOUCHES.md](../../../../docs/fork/CORE_TOUCHES.md). The ADR 0001 ladder is exhausted below it: the settings namespace is owner-registered (a second `register` throws, so no fork `base` layer), the plugin has no config knob, and seeding `preference: 'light'` into `$DSH_HOME/settings.yaml` would write a user override the user never chose into a document the dsh CLI shares.
- **The 主题 row is real and the density row is gone.** The General tab's theme placeholder became a light/dark/system select over `ctx.theme` (an apply-closure mirror store on the page's hooks channel, writes through the service's only write entry). The density placeholder row is removed: §7 fixed one density, so nothing ships behind a「即将上线」promise; the scale rides the brand layer instead.
- **The wordmark keeps its owner.** ui-inbox already rendered the `daypaw` text; the layer colors it through `--dsw-alias-brand-text`. Renaming stays a token-level change as ruled.

## Alternatives considered

- **`theme.register()` a selectable daypaw theme** — rejected: the brand is the shell's look, not a user-selectable extra; a registered theme would leave the built-in light/dark themes unbranded whenever selected, and third-party registered ids stay in-process by design.
- **Ship the density scale as a CSS file in the brand bundle** — rejected: brand values would live in two homes (stylesheet plus theme layer); the override layer keeps one source, applies before the components paint, asserts cleanly in jsdom lanes, and disposes with the plugin fiber.
- **Mint `--dsw-alias-space-*` names** — rejected: the `--dsw-*` namespace is upstream-owned; upstream minting the same names with different values would collide at the next sync.
- **Seed the durable preference to light at first boot** — rejected: writes a user-layer override the user never chose, into the settings document shared with the dsh CLI, and races the browser's first read.
- **Reuse the upstream AppearanceRow through the `settings.general.item` seat** — rejected: that seat carries the dormant upstream General ecosystem; rendering it would pull dev-shell rows into the fork page. The fork row mirrors the language row's select shape instead.

## Consequences

The shell renders warm-orange on warm-neutral in both palettes, boots light everywhere, and switches through the durable preference; the assembled `brand-theme` golden pins the whole chain (boot tokens, the row-driven dark flip, `system` resolving back to light in a media-query-less environment, spacing scheme-invariance). Cost: the `DEFAULT_PREFERENCE` touch changes the upstream dsh web shell's default too and must be replayed at every sync; the pre-plugin boot interval rides the base palettes (the loading shimmer is neutral); and future palette or density revisions are hand-checked contrast edits in one file rather than computed scales.
