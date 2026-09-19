# Agent Note: Workflow definitions reach the launcher roster

Status: implemented

English | [中文](2026-09-19-daypaw-workflow-rows-in-launcher.zh.md)

## Problem

The engine registers two definition families, and both are first-class everywhere except the launcher: `durable/listDefinitions` returns agents and workflows alike, `durable/startRun` takes either, and the board and detail column already render workflow runs. A roster narrowed to `kind === 'agent'` leaves a workspace's `daypaw/agents/*.mjs` workflow definitions without a product entry, so a workflow load cannot start at all ([ticket #127](https://github.com/0xnicholas/daypaw-pro/issues/127)).

Ruling #65 item 6 fixes the roster as the registry itself. The submit sequence, not the roster, is what blocks a workflow row: it mints a run id, calls `durable/startRun`, and then waits for the run's session twin to reach the sessions list, because an agent run's session identity is its runId and `sessions.open` refuses an unlisted id. A workflow run has no session (ADR 0016), so that wait ends at its bound and reports a generic failure for a run the engine started correctly.

`inputKind` is `null` for a definition without a wire face, which is every workflow definition: only the agent compile path attaches one. The renderer and `composeInput` read that `null` differently — a `?? 'text'` fallback renders the free-text box while the sender treats the draft as JSON — so a workflow row's two sides disagree about the surface.

## Decision

- **The launcher roster carries every definition the registry holds.** `DefinitionOption` carries the definition's `kind`, and the picker lists every row without inspecting it. An agent row keeps its business name from the declared display title; a workflow definition declares no display, so it shows its technical name.
- **A definition without an input kind uses the JSON surface on both sides.** The renderer distinguishes "no row selected" from "row whose input kind is `null`", so such a row renders the JSON box, matching what `composeInput` sends: the engine inserts the value as given, and the definition's own input contract validates it when the run starts.
- **The submit answers with what to open, decided by the definition kind.** `NewTaskOutcome` is either the created agent run's session (after the twin wait) or the created workflow run's id (no twin exists to await). The dialog routes an agent outcome to `openTask` and a workflow outcome to `openRun`.
- **The inbox owns both openings.** `InboxNewTaskDialogOwnerProps` carries `openRun` beside `openTask` with the same three effects: kick the board refetch, dismiss the dialog, and select what was created — `{ kind: 'run' }` for a session-less run, which the selection model and the detail column render.
- **The picker copy names task types, not agents.** The selector, its empty state, the JSON placeholder, and the load-failure line read neutral task-type wording in both dictionaries, under the typed keys `dialog.type.*`.
- **The Agents catalog lists agents only.** The catalog page shows the agent directory; the launcher starts work of either family. Both read the same `listDefinitions` view, and the split is stated in spec 05 §5 rather than implied by a shared projection.

## Alternatives considered

**Keep the roster agent-only and start the first workflow load elsewhere** — a script, a boot-time starter, or a workflow-aware e2e harness. Rejected: the load is meant to produce runtime cognition about a real composition, and a bespoke launcher adds a product-shaped artifact outside the `dsh` profile launch rule while leaving every later workflow load without a path. It also contradicts ruling #65 item 6, which the filter claimed to implement.

**Give workflow definitions their own entry surface** (a second picker or a board action). Rejected: that reintroduces the second roster that #60 and #65 removed, and it would duplicate the input surface, the minted-run-id retry, and the inline failure handling the dialog already owns.

**Keep the `?? 'text'` fallback and send the text draft for wire-less definitions.** Rejected: it silently sends a JSON-shaped task as a string, and the engine's input contract then rejects a value the dialog could have validated for syntax. The renderer and the sender have to agree on the same rule.

**Add `display` to `defineWorkflow` in this change.** Rejected as scope: the workflow catalog view has no consumer yet, and the technical name is honest for a definition that declares nothing else. It stays a named gap rather than a guessed title.

## Consequences

- A workflow definition in the workspace roster starts like an agent definition — minted run id, inline failures, board refetch — and the created run opens as the run itself.
- The engine's HITL gate still has no product resolver. `resolveGate` is a host method, not a `@Remote` endpoint, so a real workflow's `ctx.waitFor` reaches its timeout branch unless host code settles it. The first real load records that as a finding rather than a defect of this change.
- Copy changed on the new-task dialog; the component snapshot carries the new wording, and the locale key set moved with it.
- Coverage: the store spec asserts that the roster carries every definition and that a workflow submit resolves without waiting for a session twin; the dialog spec asserts the workflow row's JSON surface and the `openRun` hand-off; the nav spec's owner-contract case asserts both openings.
