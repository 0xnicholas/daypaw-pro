# Agent Note: steerable 复活搁浅——已投递序号计数吞掉了 plugin 注入的 user 消息

Status: implemented

[English](2026-08-31-steer-revival-plugin-injected-user-messages.md) | 中文

## Problem

steerable agent run 停车时已记录未投递的 segment,进程死亡→复活后不再投递,后续 segment 还会跳过它(ticket #73,首个产品壳真实 run 捉获)。`@daypaw/sdk` 的 `countDeliveredSteers` 按全部 `user/message` 事件数计算已投递序号,假设 user 消息只可能是初始输入、RESUME 唤醒与 steer 投递。注入生产者上下文的宿主组合——agent-loop 的 runtime-context 快照携带 `source: {kind: 'plugin', …}`——会加入 body 从未投递的 user 消息,每次注入使序号虚高一。纯 SDK 测试宿主零注入,故既有 steer/复活测试全绿。

## Decision

`userMessageText` 只接受 user 源消息(`source.kind === 'user'`),已投递序号只数 body 自己投递的消息:初始输入、RESUME 唤醒、steer segment。生产者注入的上下文(runtime-context 快照、relay、recall、tool result)一律不计。消息源判别联合即结构标记;计数与投递读同一字段,不引入文本启发或标记消息。

## Alternatives considered

**用会话文本做 segment 内容匹配。** 否决:两条内容相同的追问是合法的两次投递;序号身份之所以存在,正因为内容不是身份。

**给 steer 投递的 source 加 SDK 私有标记。** 否决:`MessageSourceMap` 已判别生产者;第二个 SDK 私有轴是重复。

## Consequences

- 回归测试:停车 → 向活会话注入一条 plugin 源快照 → 杀进程 → 死亡期间记录 segment → 断言复活投递(无修复时红:停车的复活永不唤醒)。
- 旧计数下已搁浅的 run 不会自愈(其日志中的序号已经错了);steer 一次推到终态,或 rerun。
