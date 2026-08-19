# daypaw-skeleton example

English | [中文](README.zh.md)

Runnable demo of the daypaw walking skeleton ([ADR 0008](../../docs/adr/0008-landing-order-walking-skeleton.md)): a three-step durable workflow that survives a real `SIGKILL`.

## Run

```sh
node --import tsx/esm examples/daypaw-skeleton/src/main.ts \
  --db /tmp/demo-ledger.db --effects /tmp/demo-effects.log \
  --run-id demo-1 --step-delay-ms 300
```

Kill it mid-run (`kill -9`), then restart without `--run-id`: the boot scan revives the unfinished run, completed steps return their recorded results without re-executing, and the run finishes with its typed output. With `--run-id`, the restart attaches to the same run and prints the result.

`cordis.yml` is the demo composition (engine over a local ledger file); [tests/sigkill.spec.ts](tests/sigkill.spec.ts) is the proof-line suite — kill after the first step's effect, assert exactly-once completed steps and a `done` row with the typed result.

## Model Experience

Not applicable — this example orchestrates no model calls.

## Known Limitations and Deferred Work

- **Host is a demo** — argument parsing and the effects log exist for the SIGKILL suite; real hosts compose their own Cordis application with the same plugin row.
