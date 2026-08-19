# @daypaw/store

[English](README.md) | 中文

daypaw 引擎 ledger 的共享 SQLite 契约。本包拥有物理布局——schema 常量、行类型、编号 SQL 迁移与 open/migrate 序列——仅此而已：一切状态裁决在 [`@daypaw/engine`](../engine/README.md)。设计权威：[spec 第 1 章 §3–§4](../../../docs/spec/01-durable-execution.md)；包切分：[ADR 0006](../../../docs/adr/0006-engine-package-structure.md)。

## 存储模型

单一独立 SQLite 库文件（WAL、`busy_timeout`、`foreign_keys ON`），属主独占创建，打开即迁移：

- `runs` — 每个 durable run 一行：定义身份、输入、状态、认领、父子链、类型化输出/失败。
- `journal` — 每个幂等 step 一行（`(run_id, step_key)` 主键即去重闸）：名字、occurrence、状态、已记录结果或失败。

## API

- `openLedgerDatabase(path)` — 打开（属主独占创建）并迁移 ledger 文件，或 `:memory:`。
- `migrateDatabase(db, migrations?)` — 应用待迁移段；每段的 SQL 与其 `PRAGMA user_version` 戳在同一事务内提交。
- `MIGRATIONS`、`DAYPAW_STORE_SCHEMA_VERSION`、`RUNS_TABLE` / `JOURNAL_TABLE`、`RunRow` / `JournalRow` — 契约常量与行类型。

迁移为编号、单调、手写 SQL（以可评审的 TS 模板字符串承载，使编译后的 `lib/` 自包含）。盖有比本构建更新的版本戳的库在打开时拒绝；向前兼容靠迁移，向后不作承诺。

## Model Experience

### Stored domain records

#### What the model sees

无。本包不贡献 prompt、工具或 schema；它以 `openLedgerDatabase` 承载引擎的 `runs` 与 `journal` 表。

#### Token effect

零 live-request token。

#### KV Cache effect

无——ledger 永不进入 live request 前缀。

## Known Limitations and Deferred Work

- **仅 runs 与 journal** —— command 与关联层属于 Manager/EVO 子项目（ADR 0009），刻意缺席。
- **尚无 `retry_policy_json` 列** —— retry 面已推迟；该列随其落地以后续迁移加入（简化裁决，issue #24）。
- **单进程属主纪律归引擎** —— 本包除 SQLite WAL 语义外既不强制也不描述跨进程写策略。
