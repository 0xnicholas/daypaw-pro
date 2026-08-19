# ADR 0006: 引擎包结构（packages/daypaw/ 切分）

- **状态**：已接受（2026-08-30，[引擎包结构（packages/daypaw/ 切分）](https://github.com/0xnicholas/daypaw-pro/issues/11)）
- **前置**：ADR 0001（fork 卫生：新 family `packages/daypaw/`、`@daypaw/*` 独立 0.x）、ADR 0002（`ctx.durable` 插件族、boot 扫描、storage seam）、ADR 0003（SDK 纯库 facade）、ADR 0004 §6（EVO/Manager 数据契约互不穿透）
- **事实底座**：dsh 加包规范（docs/cookbook/adding-a-package.md——逐包在 `tsconfig.base.json` paths 列别名，目录选择不改共享文件编辑量；`test:gui` glob 按目录覆盖 `packages/client`+`packages/host`；命名角色表）

## 决策

### 1. v1 三包，预留两座，方向铁律

```
packages/daypaw/
├── engine/   @daypaw/engine   cordis 插件族：ctx.durable、journal/timer/promise、boot 扫描、定义注册表
├── sdk/      @daypaw/sdk      defineAgent/defineWorkflow、run()/RunHandle facade（纯库）
├── store/    @daypaw/store    共享 SQLite 契约：schema 常量 + 行类型 + 迁移骨架（无业务逻辑）
├── (预留) manager/            host 侧路由 + manager host 进程——子项目立项时建（ADR 0009）
├── (预留) evo/                优化 workflow 定义 + 自身表——子项目立项时建（ADR 0009）
└── (预留) ui-*/               Manager client 侧插槽插件——同上
```

- **依赖方向铁律**：`sdk → engine → store`；manager/evo → store（+各自所需：manager 直读账本、evo 用 sdk 定义 workflow），**manager 与 evo 不被任何包依赖**；engine 不依赖 sdk。
- **空壳包是自锁**：spec 未到的包不建（雾不预切）；预留位只锁方向，不锁形状。

否决：五包一次切全（manager/evo 无 spec 支撑，空壳锁死未来形状）；单包合体（ADR 0002/0003 已定形引擎与编程模型边界，合体包内无 seam）。

### 2. 定义注册表内置 engine

boot 扫描复活 workflow 需拿 body——注册表是引擎的执行索引，「冷复活不需原调用者」（ADR 0003 §4）以它为前提。引擎侧存**不透明记录**（kind/name/version/body thunk，zod 与组合行细节不进引擎类型面）；SDK 经引擎服务面注册。否决：独立 registry 包（无第三消费者，纯目录美学）；SDK 拥有注册表（冷复活需 SDK 装配在场，boot 语义变弱，Manager Run Registry 视图还得回头依赖 sdk）。

### 3. `@daypaw/store`：共享数据契约的代码形态

ledger / commands / 关联层的 schema 常量 + TS 行类型 + 建库/迁移骨架，集中一处；**不含业务逻辑**。engine 依赖它写账读命令；manager host 依赖它读账写命令写 feedback；evo 依赖它读账、写自身表。**evo 输出表 schema 归 evo 包**（「EVO 拥有自身输出表」不破），store 只留扩展位（表命名空间约定）。ADR 0004 §6「互不经过对方代码路径」不违：store 是第三方中立契约包，各支柱的共同依赖而非彼此的路径。

否决：文档镜像 SQL（schema 漂移无编译期防护）；store 含全部表（违反 evo 表形态随第 4 章定的既有裁决）。

### 4. ui 插件住 `packages/daypaw/ui-*`（家族团聚）

client 侧插件不搬去上游 `packages/client/`：daypaw 全部代码一个子树可审计，与 ADR 0001「新 family 纯新增」姿态同向。接线代价（每包两三行共享配置，均可加性合并）：`tsconfig.client.json` 聚合行 + `tsconfig.base.json` paths 别名 + vitest GUI project glob 补行——按加包 checklist 登记。否决：贴上游目录惯例（家族散两处，寻址成本永久化，换来的 glob 免配置是几行一次性成本）。

### 5. profile 接线（daypaw profile 的 bundle 面）

自有 daypaw profile 组合：engine 插件 + storage sqlite 后端（+ 后续 manager 路由包）。SDK 不是插件——是应用自己的 Cordis 组合里的进程内库。bundle 行的具体清单 = spec 00-overview 撰写期设计题。

## 后果

- 00-overview 章包图输入：三包 + 两预留位 + 方向铁律（本 ADR §1 图即种子）。
- `tsconfig.base.json` paths 的 daypaw 段、vitest project 补行 = 首包落地时按 checklist 执行并登记 CORE_TOUCHES（共享配置文件的加性例外）。
- store 的迁移机制选型（手写 SQL vs drizzle 类）= spec 撰写期设计题，非 ADR 级。
