# Agent Note: Web URL 行携带启动令牌

Status: implemented

[English](2026-08-30-web-url-line-launch-token.md) | 中文

## Problem

daypaw web 应用打印的 `daypaw web: http://127.0.0.1:<端口>` 不带凭据,而 2026-08-28 同步把浏览器认证栅栏移植进了 `dsh-client-connection`:裸源收到 `401 dsh web authentication required; reopen the URL printed by dsh web.`。客户打开打印行即撞死链,发布 CLI 冒烟对 `/` 的裸 fetch 同样失败。

## Decision

- URL 行(环回与 LAN 两种)经 `connection.authenticatedUrl` 组合,镜像上游 `bundle/web-app` 的公告:行内携带进程启动令牌作为唯一认证输入。打印保持在既有 Loader 结算与拆除门控之下,位于 `ctx.inject(['connection'], …)` 内。
- 发布 CLI 冒烟改走浏览器握手而非裸源 fetch:从行内捕获完整令牌 URL,交换令牌(期望 `303` 加会话 cookie),再携 cookie fetch `/` 并要求页面包含 daypaw。无令牌的行或坏栅栏都会按名使冒烟失败。
- `DSH_WEB_URL` 与 Web 表层提示词继续解析裸源,与上游一致:模型不打开浏览器,该变量是上下文而非登录入口。

## Alternatives considered

**为 daypaw profile 关闭浏览器认证。** 否决:栅栏是产品本地 Web 的安全姿态;fork 组合应当承载它而非剥掉它。

**冒烟探测免认证的健康路径。** 否决:客户路径就是握手;免探测会在真实路径死链时继续通过。

## Consequences

- 全新安装的 CLI 打印的 URL 可直接打开壳;冒烟端到端证明种子 profile、闭包、dist,以及如今的认证路径。
- web-app 测试提供 `authenticatedUrl` 追加 `/?token=t` 的假 `connection`,并断言环回与 LAN 两种令牌行。
- `@daypaw/cli` 与 `@daypaw/web-app` 的 README 说明了令牌行，以及裸源被拒的原因。
