# ADR 0014: 浏览器平面载入控制器的家——fork 局部包

- **状态**：已接受（2026-09-17，[client load 控制器：七处手写 generation 守卫收拢](https://github.com/0xnicholas/daypaw-pro/issues/118)）
- **前置**：ADR 0001（同步策略与 fork 卫生——§4 core 触碰三问、§5 上游回赠）；ADR 0007（测试策略——`ui-*` 覆盖率豁免的边界）；`.agents/notes/implemented/architecture/2026-09-17-daypaw-durable-client-wire-face.md`（同型「跨插件面立专属包」先例）
- **事实底座**：上游 `CONTRIBUTING.md` 明写当前不接受外部 pull request；上游仓库 issues 关闭、抽样近 300 次 merge 全部来自内部 `deepseek-harness/*` 分支；上游自身至少六处手写同一守卫（`ui-model-selection/catalog.ts`、`ui-settings/settings-mirror.ts`、`ui-settings-models/store.ts`、`ui-message-feedback/dialog.ts` 等）；`jscpd`（minLines 6 / minTokens 60）全树报零克隆——这类语义重复门测不到

## 决策

### 1. 家 = fork 自有新包 `@daypaw/client-load`

七处手写代际守卫收进一个包：`LatestLoad<S>` 拥有「一次尝试」的全部——代际计数、守卫成功与失败两条落笔路径、以及「被顶替的尝试一字不落」。各 store 留下取数、投影与状态策略（何时 loading、刷新期是否保 ready、失败写什么），三段策略以 hook 形式贴在调用点。每 store 一个实例、持 store 生命周期。

### 2. 上游包袱不成立

ADR 0001 §5 的「上游回赠」只有在上游接受改动时才有价值；当前无此通道。因此把模块放进 `@deepseek-ai/dsh-client-store` 的实际含义是：fork 概念住进上游已发布的公共包，每次 sync 重放验证，而唯一收益（将来上游采用）本地包靠一句记录在案的退役触发即可保留。

### 3. 测试切法：行为一次 + 每 store 一条接线哨

不变量行为只在包内 spec 测一次（吃 per-file 100% 覆盖率门）；各 store 保留一条并发接线断言——「入口路径共享同一个控制器」是 store 侧唯一的新失效模式，且只在重叠时显形。十二条重复用例删除。

### 4. 包名不取 `ui-` 前缀

`packages/daypaw/ui-*/src/**` 的覆盖率豁免是 GUI 债的姿态；把纯逻辑包命名进该 glob 是豁免语义污染。纯结算规则归 per-file 门，成本对本模块接近零。

## 考虑过的替代方案

**上游包补丁**（`packages/client/store/src/`，标「上游 PR 候选」）。见 §2：无接受通道时只付成本。**复用既有 fork 包**（`durable-client` / `ui-inbox` / `ui-settings`）：三者都已在消费方依赖表里、建制成本为零，但分别是「wire 词汇家的术语稀释」与「功能包当兄弟包的库」——后者正是 `@daypaw/durable-client` 裁决否决过的同一地址。**只抽守卫对象**（`begin()`/`settle`/`fail`）：更薄，但 store 仍可在自己的 `catch` 里无守卫落笔，不变量沦为建议。**控制器拥有四值 status + 刷新旋钮**：调用点最短，代价是强加状态字段契约并把两处真实策略差异塞进参数。**保留七份守卫、只共享测试**：不变量仍留七个代码家、二十一个守卫点。

## 后果

- core touch 只多 `tsconfig.client.json` 一行引用（追加入既有登记行）；零上游源码改动。
- 七个 store 各缩到「取数 + 三段策略」；可观测行为零变化（迁移后 66 条 store spec 全绿）。
- 退役触发：上游若自建同等物，本包在下次 sync 评估退役（README Known Limitations 记录）。
- 边界：控制器不取消读、不共享在飞读、不缓存、不管错误文案与状态命名；惰性装载约定（`ui-settings` 的 `LazilyLoaded`）不并入。
