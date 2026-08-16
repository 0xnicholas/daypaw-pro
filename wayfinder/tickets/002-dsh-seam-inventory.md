---
title: "dsh seam 清点（四支柱相关）"
type: research
status: open
assignee:
blocked-by: []
---

## Question

对本地仓库 `/Users/nicholasl/Documents/build-whatever/deepseek-harness`（只读）做一次面向四支柱的 seam 清点：① agent 生命周期与 waterfall 事件（agent/pre-step、agent/request、tools/*、turn 流）的确切签名与拦截能力；② jobs / workflow / schedule / spill 四个族的契约与**持久化缺口**（哪些状态在内存、进程死后丢什么）；③ session-persistence（jsonl/sqlite）、storage 族、session-checkpoint-policy 提供的表面；④ telemetry（session-telemetry-otel）、runtime-diagnostics、feedback 族已记录什么数据；⑤ SDK protocol/client/server 的 wire 能力边界（能驱动什么、不能驱动什么）；⑥ 新增 in-tree package + profile/bundle 组合的规范路径（含测试规范）。产出：每个支柱「可直接挂载的 seam / 需要新造的 seam」清单，供 G2/G3/G4/引擎包结构 fog 使用。
