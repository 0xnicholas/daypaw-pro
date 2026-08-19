# daypaw-skeleton 示例

[English](README.md) | 中文

daypaw 走骨的可运行演示（[ADR 0008](../../docs/adr/0008-landing-order-walking-skeleton.md)）：一个在真 `SIGKILL` 下存活的三步 durable workflow。

## 运行

```sh
node --import tsx/esm examples/daypaw-skeleton/src/main.ts \
  --db /tmp/demo-ledger.db --effects /tmp/demo-effects.log \
  --run-id demo-1 --step-delay-ms 300
```

运行中杀掉（`kill -9`），随后不带 `--runId` 重启：boot 扫描复活未完 run，已完成 step 返回已记录结果不再执行，run 以类型化输出收尾。带 `--run-id` 重启则 attach 同一 run 并打印结果。

`cordis.yml` 是演示组合（engine 落本地 ledger 文件）；[tests/sigkill.spec.ts](tests/sigkill.spec.ts) 是证明线套件——第一步效果出现后杀死，断言已完成 step 恰一次与带类型化结果的 `done` 行。

## Model Experience

不适用——本示例不编排任何模型调用。

## Known Limitations and Deferred Work

- **宿主是演示** —— 参数解析与 effects 日志为 SIGKILL 套件存在；真实宿主以同一插件行组装自己的 Cordis 应用。
