# CORE_TOUCHES.md — 上游文件改动登记

每登记一条：文件、原因、「上游 PR 候选？」标记。每次同步仪式（ADR 0001）逐条重放验证；被上游接受的改动在下一次 sync 后划掉。

| 文件 | 改动 | 原因 | 上游 PR 候选？ | 登记批次 |
|---|---|---|---|---|
| `AGENTS.md` | 文末追加「daypaw-pro (fork layer)」节（issue tracker / triage labels / domain docs 指引） | pi 项目指引须随 AGENTS.md 自动加载；上游段落保持原样、上游所有 | 否（fork 私有流程） | A（fork 导入） |
