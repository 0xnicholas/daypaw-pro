# @daypaw/store

English | [中文](README.zh.md)

Shared SQLite contract for the daypaw engine ledger. This package owns the physical layout — schema constants, row types, numbered SQL migrations, and the open/migrate sequence — and nothing else: every state decision lives in [`@daypaw/engine`](../engine/README.md). Design authority: [spec ch.1 §3–§4](../../../docs/spec/01-durable-execution.md); package split: [ADR 0006](../../../docs/adr/0006-engine-package-structure.md).

## Storage model

One standalone SQLite database file (WAL, `busy_timeout`, `foreign_keys ON`), created owner-only, migrated on open:

- `runs` — one row per durable run: definition identity, input, status, claim, parent link, typed output/failure.
- `journal` — one row per idempotent step (`(run_id, step_key)` primary key is the dedup gate): name, occurrence, status, recorded result or failure.

## API

- `openLedgerDatabase(path)` — open (creating owner-only) and migrate a ledger file, or `:memory:`.
- `migrateDatabase(db, migrations?)` — apply pending segments; each segment commits its SQL plus its `PRAGMA user_version` stamp in one transaction.
- `MIGRATIONS`, `DAYPAW_STORE_SCHEMA_VERSION`, `RUNS_TABLE` / `JOURNAL_TABLE`, `RunRow` / `JournalRow` — the contract constants and row types.

Migrations are numbered, monotonic, hand-written SQL (as reviewable TS template strings so compiled `lib/` stays self-contained). Databases stamped newer than this build reject on open; forward compatibility comes from migrations, backward is not promised.

## Model Experience

### Stored domain records

#### What the model sees

Nothing. This package contributes no prompt, tool, or schema; it persists the engine's `runs` and `journal` tables behind `openLedgerDatabase`.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the ledger is never part of a live request prefix.

## Known Limitations and Deferred Work

- **Runs and journal only** — command and correlation tables belong to the Manager/EVO subprojects (ADR 0009) and are intentionally absent.
- **No `retry_policy_json` column yet** — the retry surface is deferred; the column arrives by a later migration when that surface lands (simplification ruling, issue #24).
- **Single-process ownership discipline is the engine's job** — this package neither enforces nor documents cross-process write policy beyond SQLite WAL semantics.
