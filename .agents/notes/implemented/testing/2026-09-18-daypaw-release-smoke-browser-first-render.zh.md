# Agent Note：release 冒烟在真浏览器里执行被伺服的壳

Status: implemented

[English](2026-09-18-daypaw-release-smoke-browser-first-render.md) | 中文

## 问题

被伺服的壳的浏览器构建从不执行。组装金样(必需 `daypaw-web-goldens` 门)在 jsdom 里 boot 的是 tsdown `lib/client.js` 产物;`apps/daypaw-web/vite.config.ts` 的 vite 组合——源面 alias、`node:module` stub、`process.versions.node: "0.0.0"` define、vendor 分块——只被当 HTML 文本验证:cli 冒烟的 dist 探针就是对一次 fetch 的 `body.includes('daypaw')`。Playwright 只装给上游壳的 advisory、main-only 浏览器 replay。凡杀死被伺服渲染的 browserization 断让本车道红。([#121](https://github.com/0xnicholas/daypaw-pro/issues/121),架构评审二候选②)。

## 决策

- **载体:release cli 冒烟内的 headless 浏览器首渲染等待**(`scripts/release/daypaw.ts` 的 `browserFirstRender`)。`Release (daypaw)` 是本 fork 唯一 PR 触发、组装真产品的可执行车道--tarball、干净全局安装、真 boot、令牌交换、被伺服 dist--唯一红得了肇事 PR 的载体;必需聚合与 advisory 作业都只在 main push 跑（[车道拆分](2026-08-30-coverage-gate-main-ci-lane.zh.md)）。
- **标记:首跑 API-key 黄卡插值的 roster 名**(`通用助手`,播种 starter 的 display title)。黄卡在其检查未决时渲染 null,名字只有 `durable/listDefinitions` 应答出 starter 才到达,所以标记证明整条被伺服链——dist 模块图执行、boot 图装配、连接打开、引擎 roster、凭据检查定可见性。空白页或断连页不可能显示它;插值搭载任一语言的文案,等待对语言稳健。
- **浏览器自己走令牌交换**(goto 打印出的 launch URL,断言落在裸源);手写 fetch 探针以精确失败文钉住 303+cookie 线应答字段,两者断言不同事实。
- **单次尝试、预算给足**:probe 超时升至 120 s(冷 Chromium 经环回加载 dist),标记等待 60 s;观测到 flake 前不造重试机械——环回页面加载是浏览器测试里的稳定类,预造重议会掩盖真信号。
- **Playwright 成为 root devDependency**,仅在冒烟路径动态 import(SDK 冒烟与 `--skip-smoke` 运行永不加载);workflow 用与 CI (daypaw main) 同款的 plain `pnpm exec playwright install chromium` 装 Chromium。

## 验证

- 净树:全管线绿,冒烟日志带 `browser first render`。
- 标记等待(`getByText('通用助手')`)拒绝缺 `process.versions.node` define 的构建,而 vite build 仍绿。
- `node:module` alias 不承重首渲染:本 bundler 对 node 内建软外置,`ModuleLoader.fromInternal()` 在 `"0.0.0"` define 下即返回。门的契约是"凡杀死被伺服渲染的 browserization 断让 PR 红",不是"每个具名组合行都承重"。

## 已考虑的替代

**真 dist 的 jsdom 车道**——否决:vite dist 是带 `<script type="module">` 与相对 chunk import 的纯 ESM 图;jsdom 两者都不执行,车道意味着手写 ESM 加载器(assembled-boot 的 ModuleLoader 路子不适用于 vite index chunk),且必需聚合 main-only,肇事 PR 反正绿。

**advisory 车道扩展**——否决:advisory 作业已装 Playwright,但 advisory 车道只报告不拦截;一个错字就能弄断的 seam 要的是拦截性 owner。

**并建第二载体**——否决:一个 seam 一个 owner——镜像律的纪律;jsdom dist 车道是同一执行事实的第二声明。

## 后果

- 每个 PR 与 main push 都在 `Release (daypaw)` 内用真浏览器执行被伺服的 vite dist;车道多付约一到两分钟 Chromium 安装,冒烟 probe 预算升至 120 s。
- 被伺服壳四周的互补面自此闭合:roster 包解析检查 = 覆盖面、组装 golden 门 = 激活面、release 闭包冒烟 = 依赖闭包面、release 浏览器 boot = 执行面（[ADR 0019](../../../../docs/adr/0019-freeze-posture.md) §5）。
- 残余:fork 产品壳没有真浏览器产品流 replay(上游 `apps/web` e2e 的 fork 流程等价物);地图雾区,触发 = 首个真浏览器专属产品断裂,或首个 jsdom 金样表达不了的流程。
- 标记承载 starter 业务名(`通用助手`),故播种 starter 的显示标题与黄卡链路必须保持该值;超时红文同时指名标记与等待。
