# @daypaw/ui-settings

English | [中文](README.zh.md)

The daypaw settings surface and first-run API-key banner, a fork client UI plugin occupying the two child slots [`@daypaw/ui-inbox`](../ui-inbox/README.md) declares on its workspace registration. It implements the settings single page of [docs/spec/05-product-shell.md](../../../docs/spec/05-product-shell.md) — 通用/凭据/模型/关于 — and the yellow first-run card that sends a keyless deployment there. Facts come through the connection wire face (`agentPresets.list` / `host.describe` / `llm.providers` / `credentials.*`); the host stays the single fact source and every write reloads from its answer.

Two registrations in one `apply`, all pure-props components over apply-closure snapshot stores:

- `SettingsPage` occupies `'inbox.settings.page'` (single, session-maybe). A left tab rail over four sections: 通用 switches the active locale through the locale service and the theme preference (light/dark/system) through the theme service — one apply-closure mirror store per row face; 凭据 renders one inline-editing row per configurable provider, joining `llm.providers` with a batched `credentials.describe` over each provider's conventional reference (`DEEPSEEK_API_KEY`-style, derived by `deriveKeyRef`); 模型 delegates to the upstream `'settings.section'` slot — declared on this page's entry with root scope, rendered with `only: 'models'` — which wakes the dormant [`ui-settings-models`](../../client/ui-settings-models/README.md) section; 关于 shows the `host.describe` facts and copies a plain-text diagnostics block to the clipboard. Tab loads are lazy (an unopened tab ignores invalidations) and latest-load-wins.
- `ApiKeyCard` occupies `'inbox.workspace.banner'` (list, id `api-key`, order 0). The readiness check joins the default agent preset's display name with the host's provider (deepseek while unnamed) and the credential state of that provider's conventional reference. Following the onboarding-ledger mechanics, the card IS the completion ledger — configured state dismisses it, no persisted flag — and it renders null while the check is undecided. Its button presets the 凭据 tab and navigates to the settings page; while visible with a current session it raises a localized composer block through `ctx.get('conversation')?.blocks`.

The active tab lives in one apply-closure `SettingsTabController` so the banner can preset 凭据 before navigating. Pushed invalidations (`credentials/updated`, `connection/reset`) always re-run the banner check and refresh only already-loaded tabs. Copy rides the plugin-owned `daypaw-settings` locale namespace (zh product copy as the key-set source of truth, plus the mechanically required en dictionary). Styling is CSS Modules over `--dsw-alias-*` semantic tokens only.

## Model Experience

### Settings page and first-run banner UI

#### What the model sees

Nothing. This package renders operator-facing UI only: `SettingsPage` and `ApiKeyCard` contribute no prompt, tool, or schema, credential values cross the wire but never the model boundary, and nothing here reaches a model request.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The composer block is a lazy seat** — the fork shell has no composer yet, so the input block the banner raises is a no-op until the conversation column ticket lands; the wiring is asserted against a fake conversation service.
- **No assembled-web snapshot pins this package's output** — the fork's assembled web lane (`apps/daypaw-web/tests/`, landed with the task-conversation ticket) boots this package but serializes only the task conversation; the settings page and banner stay covered by component and apply specs only.
- **`deriveKeyRef`/`messageOf` restate upstream helpers** — the client bundle purity gate forbids a cross-plugin value import from `ui-settings-models`, so the two one-liners are rewritten here and asserted by this package's tests.
- **Density is not a preference** — spec 05 §7 fixed one density (medium-low), carried as the `--dp-space-*` scale by [`@daypaw/ui-brand`](../ui-brand/README.md); the General tab therefore ships no density row.
