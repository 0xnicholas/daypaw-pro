# Agent Note: daypaw CSS passes the upstream stylesheet scan

Status: implemented

English | [中文](2026-09-05-daypaw-stylesheet-scan-alignment.zh.md)

## Problem

Upstream commit `7020c7e122` (inside the 2026-08-28-checkpoint..master sync window) ships repo-level stylesheet-contract specs in `ui-theme/tests` that walk every CSS file under `packages/`: every full-round `border-radius` pairs `corner-shape: round` in the same rule, no rule pairs an lv/elevation box-shadow with a neutral-border-token border, every solid neutral-token border is 0.5px, every border-token filled divider is 0.5px, and `--dsh-scrollbar-*` rebinds form complete l2 pairs on every sheet that scrolls on an elevated surface. The scan root includes `packages/daypaw`, which the sync does not rewrite, so the gate would land red on fork-owned sheets with no merge-side fix.

## Decision

Daypaw's CSS modules satisfy those specs. The state was verified before the specs exist on this tree by running upstream's own spec files (overlaid uncommitted at their upstream paths, with upstream's `corner-shape.css`, `design-platform.css`, and `gradient-shadow-text.css` that are ahead of this tree until the sync) against this checkout: the daypaw slice of every repo-wide failure list is empty. The conversion followed the compensation mapping upstream's own sweep used — four-side card boxes l2→l4, interactive controls and form fields l2→l3, separators keep l2 — over 15 solid neutral borders, and paired `corner-shape: round` onto the two full-round radii (`InboxNav` `.iconButton`, `settings-page` `.warningDot`). `agents-page` `.card:hover` deepens to `--dsw-alias-label-dimmed`, upstream's hover target for l4-resting cards; an l3 hover stroke would sit lighter than the l4 resting stroke. No daypaw rule paired an elevation shadow with a neutral border or painted a 1px filled divider, and every scrolling-on-elevated sheet already carried the complete l2 rebind pair, so those rules passed unchanged.

The brand layer ([shell brand theme](../feature/2026-08-27-daypaw-shell-brand-theme.md)) is outside the scan's reach by construction: it is a TS token-override map, not CSS on disk, and it keeps the `--dsw-alias-scrollbar-*` set and the border ladder complete per scheme, so it needed no change. Stroke weight and corner pairing are upstream visual language the shell composes, not brand identity — the brand claims palette and density (spec 05 §7), and no fork record stakes identity on 1px strokes — so ticket [#88](https://github.com/0xnicholas/daypaw-pro/issues/88)'s brand-conflict docket stays empty and its "ask upstream to narrow the scan" escalation is unused.

## Alternatives considered

- **Fix forward at sync time** — rejected: the specs land inside the sync, so a red scan blocks the sync's gate replay, and mirroring the sweep is cheaper before upstream's files arrive than under them.
- **Keep 1px strokes as fork brand and request an upstream scan exclusion for `packages/daypaw`** — rejected: the brand layer claims color and density, not stroke weight, and an exclusion would fork the visual language the shell deliberately composes over.
- **Deepen every converted border to l4 uniformly** — rejected: upstream's sweep compensates per surface kind (cards l4, controls and inputs l3, separators keep their level); a uniform mapping over-inks separators and controls.

## Consequences

The fork shell renders 0.5px hairlines and keeps true circles circular today, ahead of the sync; when the sync lands, the new ui-theme specs pass over `packages/daypaw` without merge-side CSS edits. The 0.5px warm-tinted separators (brand l2 tint at half width) are the one surface worth an eyeball in the running shell — consistent with upstream's own post-sweep look, and a value-level brand tweak of the border-ladder alphas stays possible without touching this contract. Cost: the compensation mapping is now a sync-follow obligation — if upstream later re-tunes the levels, daypaw's mirrors drift silently until a scan rule breaks; the synced specs are the tripwire.

## Verification

The harness (upstream's `tests/stylesheet-scan.ts` plus the three spec files at their upstream paths) ran over this tree via vitest and reported zero `packages/daypaw` entries in every repo-wide failure list, both before the fixes (17 daypaw entries: 15 wide borders, 2 unpaired circles) and after. Nothing of the harness is committed: the sync delivers the real specs, which from then on enforce over `packages/daypaw` like any other tree. The remaining failures in that run live in upstream-owned packages whose pre-sweep copies the sync replaces wholesale.
