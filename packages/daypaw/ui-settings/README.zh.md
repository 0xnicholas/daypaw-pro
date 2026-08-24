# @daypaw/ui-settings

[English](README.md) | 中文

daypaw 的设置面与首跑 API-key 黄卡，fork 的 client UI 插件，占据 [`@daypaw/ui-inbox`](../ui-inbox/README.md) 在其工作台注册上声明的两个子槽。它实现 [docs/spec/05-product-shell.md](../../../docs/spec/05-product-shell.md) 的设置单页——通用/凭据/模型/关于——以及把无 key 部署引向那里的首跑黄卡。事实全部走 connection wire 面（`agentPresets.list` / `host.describe` / `llm.providers` / `credentials.*`）；host 是唯一事实源，每次写入后都从它的回答重载。

一个 `apply` 里两次注册，全部是纯 props 组件，数据来自 apply 闭包自有的 snapshot store：

- `SettingsPage` 占据 `'inbox.settings.page'`（single，session-maybe）。左侧 tab 轨带四个分区：通用经 locale 服务切换界面语言（主题与密度行是占位）；凭据为每个可配置 provider 渲染一行内联编辑器，把 `llm.providers` 与按各 provider 约定引用（`DEEPSEEK_API_KEY` 式，由 `deriveKeyRef` 推导）的批量 `credentials.describe` 相 join；模型委托给上游 `'settings.section'` 槽——在本页 entry 上以 root scope 声明、以 `only: 'models'` 渲染——从而唤醒休眠的 [`ui-settings-models`](../../client/ui-settings-models/README.md) 分区；关于展示 `host.describe` 事实并把纯文本诊断块复制到剪贴板。tab 加载是惰性的（未打开的 tab 忽略失效推送），且最新一次加载生效。
- `ApiKeyCard` 占据 `'inbox.workspace.banner'`（list，id `api-key`，order 0）。就绪检查把默认 agent preset 的显示名、host 的 provider（未具名时回落 deepseek）与该 provider 约定引用的凭据状态相 join。遵循 onboarding-ledger 机制：黄卡本身就是完成账本——凭据已配置即消失，无持久化 flag——检查未决时渲染 null。其按钮先预选 凭据 tab 再导航到设置页；可见且存在当前会话时，经 `ctx.get('conversation')?.blocks` 抬起一条本地化文案的输入禁用。

活动 tab 存在同一个 apply 闭包 `SettingsTabController` 里，黄卡因此能在导航前预选 凭据。失效推送（`credentials/updated`、`connection/reset`）总是重跑黄卡检查，且只刷新已加载的 tab。文案走插件自有 `daypaw-settings` locale 命名空间（zh 产品文案为 key 集权威，外加机制要求的 en 词典）。样式只用 CSS Modules 消费 `--dsw-alias-*` 语义 token。

## Model Experience

### 设置页与首跑黄卡 UI

#### What the model sees

无。本包只渲染面向操作者的 UI：`SettingsPage` 与 `ApiKeyCard` 不贡献任何 prompt、工具或 schema，凭据值只过 wire、不过模型边界，这里没有任何东西进入模型请求。

#### Token effect

零 live-request token。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **输入禁用是惰性席位**——fork 壳还没有对话栏，黄卡抬起的输入禁用是对话栏票落地前的 no-op；该接线以假 conversation 服务断言。
- **无组装级 web 快照覆盖**——fork 组合没有可运行的 web 快照 harness，本包的界面输出只由组件与 apply 规格覆盖（与 `@daypaw/ui-inbox` 同级）。
- **`deriveKeyRef`/`messageOf` 重述上游 helper**——client bundle purity gate 禁止从 `ui-settings-models` 跨插件 value import，两个一行函数在此重写并由本包测试断言。
- **主题与密度行是占位**——两者都渲染「即将上线」，等各自的能力票落地。
