# Agent Note: The browser-plane load controller (`@daypaw/client-load`)

Status: implemented

English | [中文](2026-09-17-daypaw-client-load-controller.zh.md)

## Problem

Seven hand-written load paths in the fork's shell stores repeated one ritual: bump a generation counter, write the loading status, await the wire read, then write the outcome only if that attempt was still the newest. `RunsBoardStore` and `TaskDetailStore` ([`@daypaw/ui-inbox`](../../../../packages/daypaw/ui-inbox/README.md)), `CatalogStore` ([`@daypaw/ui-agents`](../../../../packages/daypaw/ui-agents/README.md)), `AboutStore`, `ApiKeyCardStore` and `CredentialsStore` ([`@daypaw/ui-settings`](../../../../packages/daypaw/ui-settings/README.md)), and `NewTaskStore` ([`@daypaw/ui-tasks`](../../../../packages/daypaw/ui-tasks/README.md)) each owned a copy of the rule and three guard sites per copy — success, failure, and the check that a superseded attempt writes neither. The rule is easy to get half right: guarding the success write while letting a stale rejection paint an error status is the same bug with a quieter symptom.

The tests duplicated the same way. Six spec files carried thirteen staleness cases, twelve of them the same assertion written against a different store. The repository's own clone detector could not see any of it: `jscpd` (minLines 6, minTokens 60) reports zero clones across the tree, because the repetition is semantic — the payload differs at every line while the skeleton is shared.

## Decision

`@daypaw/client-load` owns the rule, and the rule is all it owns ([ticket #118](https://github.com/0xnicholas/daypaw-pro/issues/118)). `LatestLoad<S>` wraps a store's `SnapshotStore`: `run(fetch, policy)` takes one attempt's generation number, applies the policy's `start` writes synchronously, awaits the read, then lets the attempt write only while it is still the newest — a superseded attempt returns having written nothing, its data and its rejection alike. `invalidate()` supersedes an in-flight attempt without starting one, for the clear/selection path. One instance per store, held for the store's lifetime; the counter is the instance's state.

The store keeps what is genuinely its own: the read, the projection into its snapshot, and the status policy — when to show `loading`, whether a refresh keeps `ready` data on screen (`RunsBoardStore` during a poll tick, `TaskDetailStore` on a same-run refresh), what a failure writes (`error` status alone, an error message, or the banner's deliberate silence). Those differences are real domain differences, so they stay at the call site as three policy hooks instead of becoming parameters of a general controller. The controller has no opinion about status, error text, cancellation, in-flight sharing, or caching.

The home is fork-local rather than upstream, because the upstream contribution path does not exist: `deepseek-ai/deepseek-harness` states in its CONTRIBUTING that it cannot accept external pull requests at the moment, its issues are disabled, and every merge in its history comes from an internal `deepseek-harness/*` branch. Adding the module to `@deepseek-ai/dsh-client-store` would therefore buy no upstream adoption while paying the core-touch cost ADR 0001 §4 registers: an upstream file, replayed and re-verified at every sync ritual, in a package upstream re-touches about monthly. Upstream does hand-roll the same guard in at least six places (`ui-model-selection/catalog.ts`, `ui-settings/settings-mirror.ts`, `ui-settings-models/store.ts`, `ui-message-feedback/dialog.ts`, and others), so if upstream ever grows the abstraction itself, this package is a candidate to retire at that sync and the README records that trigger.

Tests follow the same split. `@daypaw/client-load`'s own spec covers the behavior matrix — both supersede paths, `start` running for an attempt that will be superseded, the optional hooks, `invalidate()` in flight and idle — under the fork's per-file 100% coverage gate, which applies because the package is outside the `ui-*` GUI-debt exemption. Each store keeps exactly one wiring assertion: overlapping loads through its own entry paths must not let the older one win, which is the one failure a per-call controller would reintroduce silently and the only concurrency property the store's other specs never exercise. Twelve duplicated cases were deleted; seven remain.

## Alternatives considered

**Add the controller to upstream's `@deepseek-ai/dsh-client-store`.** It is the natural neighbor of `shallowEqual` and `createSnapshotStore`, and upstream has real consumers of the same pattern. It lost on the contribution channel: with no external PR path, the change is a fork-only divergence inside a published upstream package, registered as a core touch and replayed every sync, with the only upside — future upstream adoption — available just as well to the local package through a documented retirement trigger.

**Reuse an existing fork package: `@daypaw/durable-client`, `@daypaw/ui-inbox`, or `@daypaw/ui-settings`.** All three already sit in the consumers' dependency lists, so any of them costs nothing new to build. Each is a locality error of the kind the durable-client decision already rejected: the first is the durable wire-vocabulary home and its CONTEXT.md term would have to stretch to cover store settlement; the other two are feature packages, and `ui-settings` already holds the tab-specific `lazy-refresh.ts` convention. Depending on a feature package for cross-plugin machinery also turns today's type-only `ui-inbox` dependency into a value dependency.

**Extract only a guard object (`begin()` returning an attempt with `settle`/`fail`).** Smaller, and it leaves each store's `try`/`catch` in place. It is thinner than it looks: a store can still write state in its own `catch` block without consulting the attempt, so the invariant becomes advisory exactly where it matters.

**Let the controller own the four-value status and take only projections.** The interface would shrink to `run(fetch, { success })` for the five plain stores, with a knob for the two that keep `ready` data on screen during a refresh. It imposes a state-field contract on every adopter and pushes the two genuine policy differences into a parameter, buying two saved lines per store.

**Keep the seven guards and share only the tests.** A parameterized staleness suite would remove the test duplication without the package. The invariant would remain in seven code homes with twenty-one guard sites, and the ticket's other half — each store shrinking to its read and projection — would not happen.

## Consequences

- The generation counter has one home; the six store files hold one `LatestLoad` field each and their `load`/`select`/`fetch` bodies now read as read-plus-policy. No observable behavior changed: all 66 store specs passed against the migrated stores before the duplicated cases were deleted.
- Tests went from thirteen staleness cases in six files to seven wiring assertions plus the package's behavior matrix, which the coverage gate keeps at full branch coverage.
- Registration: one `tsconfig.client.json` reference row (appended to the existing CORE_TOUCHES entry) and one package README pair; spec 05 §5 carries the spec basis sentence, ADR 0014 records the home decision, and CONTEXT.md gains the 载入控制器 term.
- The package is deliberately not named `ui-*`: the `packages/daypaw/ui-*/src/**` coverage exemption exists for GUI debt, and a pure settlement rule belongs under the per-file gate.
- Nothing in the shell depends on this package's *identity*: each plugin's browser bundle inlines its own copy, which is correct for a stateless rule and keeps the client module table unchanged.
