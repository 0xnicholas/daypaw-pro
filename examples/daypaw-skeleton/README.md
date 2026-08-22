# daypaw-skeleton example

English | [中文](README.zh.md)

Runnable demo of the daypaw walking skeleton ([ADR 0008](../../docs/adr/0008-landing-order-walking-skeleton.md)): a three-step durable workflow that survives a real `SIGKILL`, plus the pillar-② agent compilation face ([ADR 0010](../../docs/adr/0010-define-agent-compilation-and-execution.md)) over the real dsh agent stack.

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

[tests/agent.snapshot.ts](tests/agent.snapshot.ts) pins the model-visible surface: the persisted session log diffs against committed expected output (persona prompt section, injected `submit` schema, input message), and a second scenario SIGKILLs the host mid-turn, restarts, and pins the synthetic resume steer the revived model sees.

## Model Experience

The workflow demo orchestrates no model calls. The agent demo's model-visible surface is exactly what its snapshot pins; see above.

## Known Limitations and Deferred Work

- **Host is a demo** — argument parsing and the effects log exist for the SIGKILL suite; real hosts compose their own Cordis application with the same plugin row.
