# Agent Note: agent-plane spec 的 web-transport-off overlay 改为从 roster 派生

Status: implemented

[English](2026-09-18-daypaw-agent-plane-overlay-derived.md) | 中文

## Problem

`tests/agent-plane.spec.ts` 以写入 `cordis.patch.yml` overlay 禁用 web-transport 行的方式,无头引导 daypaw 表面的真实 bundle 组合——但 overlay 的 `disabled` 行是 roster 事实:组合行是否走 web 平面,由其包是否声明浏览器半侧(`dsh.client`)决定——正是 roster 镜像门比较所用的同一键。字面量 `disabled` 集合使上游浏览器 roster 每长出一行都成为一次 spec 编辑;2026-09-13 sync 的 `ui-deliverables` 行是已记录的实例,并作为 fork 文件的同步耦合改动登记进 `docs/fork/CORE_TOUCHES.md`([#122](https://github.com/0xnicholas/daypaw-pro/issues/122),架构评审二候选③)。

## Decision

overlay 文件留载——纯宿主面组合需要有限域,profile 的 patch 顺序把它排在最后——但其内容改为在 spec 内部于引导时派生,输入即以下两者:

- **roster**:`composeEntries(profile.layers.map(layer => layer.patches))`——正是 spec 所引导的条目列表,不是对 patch 文件的第二次读取。
- **浏览器半侧**:workspace manifest 扫描 `dsh.client`(镜像门的现成模式),组合行挂载声明了浏览器半侧的包即禁用。

两条字面量边缘保留,逐行理由在 spec 内:

- `HOST_TRANSPORT_OFF`——`directory-picker`、`web-startup`、`webserver`、`web-runtime`:传输本体,挂载自无浏览器半侧的纯宿主包,派生规则无从键起。
- `HOST_PLANE_KEEP`——`typert`:`dsh-typert-registry` 声明浏览器半侧,但其节点半侧是进程内类型图注册表,`typert-loader`(宿主行)等待其 `typert` 服务。`typert` 保留,因为 `typert-loader`(宿主行)等待该注册表;全浏览器半侧派生会悬停 `typert-loader`,`boot` 的激活断言会大声失败并点名等待行,因此节点半侧服务宿主面的浏览器半侧行需要一条带理由的保留项,而非静默镜像追抄。

失效的字面量 id(sync 改名余数行或保留行)会让 spec 的 mounted-rows 用例变红,而非禁用了个空。反向用例模拟一次新增 `dsh.client` 浏览器半侧行的 roster 增长——一个声明 `dsh.client` 的 fixture workspace manifest 加上被镜像进 roster 的行——并断言派生 overlay 吸收该行而 spec 零编辑。

## Verification

五个已执行的 agent-plane 事实(裸 agent 工具目录、工作区内免询问写入、批准、悬置等待态、拒绝封闭)在派生组合下原样通过,钉住纯宿主面语义不变;两个派生用例钉住吸收性与字面量边缘。

## Alternatives considered

**保留字面量、每次 sync 追抄**:否决——事实只有一个家(roster 加 manifests);追抄已发生过一次,且镜像门只保证 fork patch 镜像增长,不保证 spec。

**扩展 roster 镜像门,顺带校验 spec 的字面量**:否决——对一个事实的两份拷贝设门,只把漂移的发现推迟到门时刻而非消除它;红的仍是同一次追抄,换了个报告者。

**放任传输行保留启用、让其等待**:否决——条目悬停时 `boot` 的 `assertEntriesActivated` 失败,且启用的 `webserver` 会在测试内绑定真实服务器。

**整层禁用 web-app patch、只留 base bundle**:否决——fork patch 承载 agent 平面组合的宿主行(`tool-ask-user`、`tool-str-replace-editor` 重挂、`approval-history`、`session-turn-outline`);整层禁用改变被测组合。

## Consequences

上游浏览器 roster 增长经派生吸收,spec 零编辑,本文件的 CORE_TOUCHES 登记行随之消解,sync 仪式在此不含编辑。派生的禁用集覆盖每个浏览器半侧行(如 `resources`、`ui-sidebar-right`、`workspace-files`),这在纯宿主面上把面向浏览器的服务链(`resources` → `sidebarRight` → `ui-chat`)整链一致地剪除,而非任其挂载不用;agent 面语义不变由已执行事实拥有证明。派生所买下的是它删除的失败类:roster 增长被静默吸收,仅剩的 sync 敏感边缘(节点半侧服务宿主面的浏览器半侧行)会让 boot 断言失败并点名等待行。
