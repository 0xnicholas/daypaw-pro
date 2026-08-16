# 第 2 章：Agent Engine + SDK（骨架输入）

> 状态：**骨架输入**——结构已定，内容待 spec 撰写期填充。决策依据 [ADR 0003](../adr/0003-engine-sdk-programming-model.md)；引擎语义见 ADR 0002 与 spec 第 1 章。

## 1. 编程模型

两类定义、一个 run 概念（ADR 0003 §1）：`defineAgent`（声明式 spec）/ `defineWorkflow`（代码编排体）/ `run()` 一等公民。示例代码、类型签名：待写。

## 2. ctx 原语面

五原语：`step` / `sleep` / `waitFor` / `agent` / `spawn`（ADR 0003 §2）。各原语的参数、返回、ledger 事件映射、错误语义：待写。子 workflow 等待式调用的原语形态：随 [SDK API 表面草图] 原型定。

## 3. 定义注册表与组合

程序化组合 + 定义注册表（ADR 0003 §3）：name+version 身份、session header 重建、与 preset 的双路并存。版本语义细节（兼容规则、EVO 变体命名）：待写，部分依赖 EVO 章。

## 4. run 生命周期

幂等 start-or-attach、RunHandle、类型化结果、cancel、boot 扫描复活（ADR 0003 §4）。与 engine ledger 的事件序列（run/start、step/*、effect、promise、timer）逐条对表：待写，与第 1 章交叉引用。

## 5. 进程形态与部署

v1 纯库、运输无关 API、进程即 worker / ledger 即队列（ADR 0003 §5）。daemon 化路径（三 Provider 替换）：运维注记待写。wire 扩展面：指针到 Manager 章（该章定夺）。

## 6. 与 dsh 既有概念的关系表

preset / composition / session / subagent seam / `session/event` ↔ 新模型的对应与边界（素材：seam 清点 §①⑤、ADR 0003 §1/§3）：待写。

## 7. 测试面

待测试策略票定调后回填。
