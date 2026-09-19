# Agent Note: Workflow definitions reach the launcher roster

Status: implemented

English | [中文](2026-09-19-daypaw-workflow-rows-in-launcher.zh.md)

## Problem

The engine registers two definition families, and the shell could only start one of them. `durable/listDefinitions` returns agents and workflows alike, `durable/startRun` takes either, the board already lists workflow runs and the detail column already draws their step timeline — but the new-task dialog filtered the roster to `kind === 'agent'`, so a workspace's `daypaw/agents/*.mjs` workflow definitions were unreachable from the product. The first real workflow load had no start path at all ([ticket #127](https://github.com/0xnicholas/daypaw-pro/issues/127)).

The filter was narrower than the ruling it cited. Ruling #65 item 6 says the registry IS the roster; the dialog's comment read that as agents only. Listing the rows would not have been enough either: the submit sequence mints a run id, calls `durable/startRun`, and then waits for the run's session twin to reach the sessions list, because an agent run's session identity is its runId and `sessions.open` refuses an unlisted id. A workflow run has no session (ADR 0016), so that wait could only end at its bound and report a generic failure for a run the engine had started correctly.

One more mismatch sat inside the input surface. `inputKind` is `null` for a definition without a wire face — which is every workflow definition, since only the agent compile path attaches one. The dialog mapped a missing row and a null kind through the same `?? 'text'` fallback, so a workflow row would have rendered the free-text box while `composeInput` sent the draft as JSON.

## Decision

- **The launcher roster carries every definition the registry holds.** `DefinitionOption` replaces `AgentOption` and adds the definition family; the picker no longer inspects `kind`. An agent row keeps its business name from the declared display title, and a workflow definition — which declares no display — shows its technical name.
- **A wire-less definition shares the JSON surface on both sides.** The renderer distinguishes "no row selected" from "row without a wire face", so a `null` input kind renders the JSON box, matching what `composeInput` sends: the engine inserts the value as given and the definition's own input contract validates it at the run boundary.
- **The submit answers with what to open, and the family decides.** `NewTaskOutcome` is either the created agent run's session (after the twin wait) or the created workflow run's id (immediately, since there is no twin to await). The dialog routes the first to `openTask` and the second to `openRun`.
- **The inbox owns both openings.** `InboxNewTaskDialogOwnerProps` gains `openRun`, implemented beside `openTask` with the same three effects: kick the board refetch, dismiss the dialog, and select what was created — `{ kind: 'run' }` for a session-less run, which the selection model and the detail column already render.
- **The picker copy stops naming agents.** The selector, its empty state, the JSON placeholder, and the load-failure line move to neutral task-type wording in both dictionaries, with the keys renamed from `dialog.agent.*` to `dialog.type.*`.
- **The Agents catalog stays agent-only.** The catalog page is the agent directory; the launcher is the surface that starts work. Both read the same `listDefinitions` view, and the asymmetry is stated in spec 05 §5 rather than implied by a shared projection.

## Alternatives considered

**Keep the roster agent-only and start the first workflow load elsewhere** — a script, a boot-time starter, or a workflow-aware e2e harness. Rejected: the load is meant to produce runtime cognition about a real composition, and a bespoke launcher adds a product-shaped artifact outside the `dsh` profile launch rule while leaving every later workflow load without a path. It also contradicts ruling #65 item 6, which the filter claimed to implement.

**Give workflow definitions their own entry surface** (a second picker or a board action). Rejected: that reintroduces the second roster that #60 and #65 removed, and it would duplicate the input surface, the minted-run-id retry, and the inline failure handling the dialog already owns.

**Keep the `?? 'text'` fallback and send the text draft for wire-less definitions.** Rejected: it silently sends a JSON-shaped task as a string, and the engine's input contract then rejects a value the dialog could have validated for syntax. The renderer and the sender have to agree on the same rule.

**Add `display` to `defineWorkflow` in this change.** Rejected as scope: the workflow catalog view has no consumer yet, and the technical name is honest for a definition that declares nothing else. It stays a named gap rather than a guessed title.

## Consequences

- A workflow definition in the workspace roster is startable from the product: minted run id, inline failures, and the board refetch behave exactly as they do for an agent, and the created run opens as the run itself.
- The engine's HITL gate still has no product resolver. `resolveGate` is a host method, not a `@Remote` endpoint, so a real workflow's `ctx.waitFor` reaches its timeout branch unless host code settles it. The first real load records that as a finding rather than a defect of this change.
- Copy changed on the new-task dialog; the component snapshot carries the new wording, and the locale key set moved with it.
- Coverage: the store spec's obsolete "workflow rows never roster" case becomes the roster-carries-every-definition case, plus a workflow submit that resolves without any session twin, and the dialog spec gains the workflow row's JSON surface and `openRun` hand-off. The nav spec's owner-contract case now asserts both openings.
