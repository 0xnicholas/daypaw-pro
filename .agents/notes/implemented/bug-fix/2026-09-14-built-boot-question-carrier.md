# Agent Note: The built-boot smoke follows the resident question's carrier session

Status: implemented

English | [中文](2026-09-14-built-boot-question-carrier.zh.md)

## Problem

The web browser snapshot lane's only interaction smoke (`apps/web/tests/built-boot.expected.e2e.ts`) fails with `Unable to find role="button" and name "Skip this question"`, a red the lane's starvation ([#111](https://github.com/0xnicholas/daypaw-pro/issues/111)) had hidden. Upstream's smoke (upstream `d419b722bb`) opens fx-alpha, skips the fixture's three questions, then allows its approval — upstream's fixture routes both the resident question and the approval to fx-alpha. The fork's fixture routes the resident question to fx-gamma ([#58](../feature/2026-08-26-daypaw-approval-board.md)) so its badge cannot shadow the approval badge on the daypaw board, with the smoke's row badge pinned to `Waiting for approval`; the fork base predated the upstream loop, so the 2026-08-28 sync merged that loop back verbatim over the fork's routing. Pending interactions mount on their carrier's conversation (the composer chain resolves the pending interaction keyed to the open session), so the question composer cannot mount in fx-alpha's view and the loop cannot pass.

## Decision

- The smoke covers both interactions on their carrier rows: fx-gamma's `Waiting for answer` row skips the three questions through the real composer chain, fx-alpha's `Waiting for approval` row allows its approval, then the unchanged ContextMeter/diff/web-row/CSS assertions resume.
- Every wait the reroute adds carries the file's explicit 10 s timeout: the default 1 s `findBy` is shorter than a mount on loaded hardware.
- The two endpoint hypotheses from the issue are excluded as causes: the question → approval → context journey passes on the shared fixture with the `dynamicCordisRunner/*` endpoints unanswered and without the [#90](../architecture/2026-09-06-durable-fixture-decorator-transport.md) durable decorator — both remain the controlled warnings and daypaw-local surface they are.

## Alternatives considered

**Move the resident question back to fx-alpha in the fixture.** Rejected: it drops #58's badge-shadow guarantee (the runtime's row badge picks questions first, so the daypaw 等待你确认 board would lose its approval key), and the fixture spec and the daypaw goldens that pin the fx-gamma home regress.

**Answer the questions through the API instead of the UI.** Rejected: the smoke proves the built bundle mounts the question composer end to end; an API answer would delete the lane's only coverage of that path.

**Restore the approval-only loop and assert the question UI stays unmounted.** Rejected: the generated roster does mount the question UI; asserting its absence would weaken the smoke below what upstream's own smoke covers.

## Consequences

- The lane's resident-interaction smoke exercises both interaction kinds through the built graph: the question composer on fx-gamma and the approval card on fx-alpha.
- The file's row in `docs/fork/CORE_TOUCHES.md` records the delta (badge copy plus carrier routing), which the sync ritual replays in place of merging upstream's hunks verbatim.
- The [lane note](../testing/2026-08-30-coverage-gate-main-ci-lane.md) carries the lane's status; fork issue #114 tracks the hosted two-green-runs acceptance.
