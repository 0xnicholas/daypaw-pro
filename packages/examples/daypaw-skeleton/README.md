---
description: "Runnable demo: the daypaw walking skeleton — a three-step durable workflow that survives a real SIGKILL, plus the pillar-2 agent compila"
kind: "package-reference"
---

# daypaw-skeleton example

English | [中文](README.zh.md)

## Summary

## Table of Contents



Runnable demo of the daypaw walking skeleton ([ADR 0008](../../../docs/adr/0008-landing-order-walking-skeleton.md)): a three-step durable workflow that survives a real `SIGKILL`, plus the pillar-② agent compilation face ([ADR 0010](../../../docs/adr/0010-define-agent-compilation-and-execution.md)) over the real dsh agent stack.

## Run

```sh
node --import tsx/esm examples/daypaw-skeleton/src/main.ts \
  --db /tmp/demo-ledger.db --effects /tmp/demo-effects.log \
  --run-id demo-1 --step-delay-ms 300
```

Kill it mid-run (`kill -9`), then restart without `--run-id`: the boot scan revives the unfinished run, completed steps return their recorded results without re-executing, and the run finishes with its typed output. With `--run-id`, the restart attaches to the same run and prints the result.

`cordis.yml` is the demo composition (engine over a local ledger file); [tests/sigkill.spec.ts](tests/sigkill.spec.ts) is the proof-line suite — kill after the first step's effect, assert exactly-once completed steps and a `done` row with the typed result.

## Agent demo

[src/agent-main.ts](src/agent-main.ts) runs a workflow whose step awaits a `defineAgent`-compiled child run through `ctx.agent`, over the real dsh agent stack with the LLM route served keylessly from a scripted replay override:

```sh
node --import tsx/esm examples/daypaw-skeleton/src/agent-main.ts \
  --db /tmp/demo-ledger.db --sessions /tmp/demo-sessions \
  --override examples/daypaw-skeleton/tests/snapshots/agent-happy/replay.override.json \
  --run-id agent-demo-1
```

[tests/agent.golden.ts](tests/agent.golden.ts) pins the model-visible surface: the persisted session log diffs against committed expected output (persona prompt section, injected `submit` schema, input message), and a second scenario SIGKILLs the host mid-turn, restarts, and pins the synthetic resume steer the revived model sees.

A third scenario exercises the steer channel (issue #53) through `--mode steer`, which drives a separate steerable definition directly: [tests/sigkill.spec.ts](tests/sigkill.spec.ts) parks a run on a submit-less turn, SIGKILLs the host, and revives it from a `--steer` segment under the same runId, while the snapshot suite pins one session log carrying both the initial input and the steered follow-up.

## Model Experience

### The workflow demo

#### What the model sees

Nothing. The workflow demo orchestrates no model calls; its three durable steps are plain compute with no prompt, tool, or schema contribution.

##### Workflow-step record

```markdown
The skeleton workflow executes three chained durable steps (first, second, third); each step records its side effect to the effects file before returning, and a killed host resumes at the step boundary on revival. No model-visible content is produced.
```

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None: the demo adds no request-prefix content.

### The agent demo

#### What the model sees

The agent demo's model-visible surface is exactly what its snapshot pins; see above.

##### Agent-turn record

```markdown
The agent demo drives a real dsh agent loop over the durable engine: the session log carries the user prompt, the assistant reply, and the steered follow-up, all replayable from the ledger.
```

#### Token effect

Bounded by the single pinned snapshot turn.

#### KV Cache effect

None: the demo adds no request-prefix content.

## Known Limitations and Deferred Work

- **Host is a demo** — argument parsing and the effects log exist for the SIGKILL suite; real hosts compose their own Cordis application with the same plugin row.

### Dev Note
