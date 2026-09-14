# Agent Note: The built-boot smoke follows the resident question's carrier session

Status: implemented

English | [中文](2026-09-14-built-boot-question-carrier.zh.md)

## Problem

The web browser snapshot lane's only interaction smoke (`apps/web/tests/built-boot.expected.e2e.ts`) stayed red once [#111](https://github.com/0xnicholas/daypaw-pro/issues/111) stopped the lane being starved: `Unable to find role="button" and name "Skip this question"`. Upstream's smoke (upstream `d419b722bb`) opens fx-alpha, skips the fixture's three questions, then allows its approval — written for upstream's fixture, where the resident question and approval both target fx-alpha. The fork's [#58](../feature/2026-08-26-daypaw-approval-board.md) moved the resident question to fx-gamma so its badge cannot shadow the approval badge on the daypaw board, and adapted the smoke's row badge to `Waiting for approval`; the fork base predated the upstream loop, so nothing conflicted. The 2026-08-28 sync then merged upstream's loop back verbatim while keeping the fork's fx-gamma routing: pending interactions mount on their carrier's conversation (the composer chain resolves the pending interaction keyed to the open session), so the question composer can never mount in fx-alpha's view and the loop can never pass. The starved lane hid that merge product until its first hosted executions.

## Decision

- The smoke pins the routing split at the row face — fx-alpha carries `Waiting for approval`, fx-gamma carries `Waiting for answer` — then drives each interaction on its carrier: open fx-alpha (chat content), route to fx-gamma's badge row and skip the three questions through the real composer chain, return to fx-alpha, allow the approval, and resume the unchanged ContextMeter/diff/web-row/CSS assertions.
- Every wait the reroute adds carries the file's explicit 10 s timeout; the failing loop's `findBy` ran at the default 1 s on a mount hosted hardware can lag.
- The two endpoint hypotheses from the issue are rejected as causes: a probe drove the full question → approval → context journey green on the shared fixture with the `dynamicCordisRunner/*` endpoints still unanswered and without the [#90](../architecture/2026-09-06-durable-fixture-decorator-transport.md) durable decorator, so both remain the controlled warnings and daypaw-local surface they already were.

## Alternatives considered

**Move the resident question back to fx-alpha in the fixture.** Rejected: it reverts #58's badge-shadow rationale (the runtime's row badge picks questions first, so the daypaw 等待你确认 board would lose its approval key) and re-reddens the fixture spec and the daypaw goldens that pin the fx-gamma home.

**Answer the questions through the API instead of the UI.** Rejected: the smoke exists to prove the built bundle mounts the question composer end to end (transport → remote event → pending interaction → composer chain); an API answer would delete the lane's only coverage of that path.

**Restore the pre-loop shape and assert the question UI stays unmounted.** Rejected: the generated roster does mount the question UI; asserting its absence would weaken the smoke below what upstream's own smoke covers.

## Consequences

- The lane's resident-interaction smoke now exercises both interaction kinds through the built graph — the question composer on fx-gamma, the approval card on fx-alpha — instead of only the approval.
- The file's row in `docs/fork/CORE_TOUCHES.md` records the extended delta (badge copy plus carrier routing), so the sync ritual replays this adaptation instead of merging upstream hunks verbatim again.
- The [lane note](../testing/2026-08-30-coverage-gate-main-ci-lane.md)'s "stays red" fact is updated in the same change; fork issue #114 tracks the hosted two-green-runs acceptance.
