---
title: "Manager 范围与控制面"
type: grilling
status: open
assignee:
blocked-by: [2, 3]
---

## Question

Agent Manager 到底是什么？要敲定：观测面（trace/session/fleet 视角；OTel 导出 vs 本地库 vs 两者；保留期）；控制操作集（哪些操作暴露给人：pause/resume/kill/fork/replay/retry/注入消息？权限模型要不要）；形态（复用/扩展 dsh web app 加管理页 vs 独立轻量 app vs 纯 CLI + OTel 后端）；与 durable engine 的关系（Manager 是 engine 的观测者还是控制者——stop/resume 走 engine 的什么 seam）；EVO 需要的数据 Manager 是否负责采集/存储（两者的数据契约）。产出 ADR 0003 + spec 第 3 章骨架输入。依赖「dsh seam 清点」与「Agent 观测/管理技术地形」。
