# dsh 可交付产物机制清点

> 研究票 [#32 「dsh 可交付产物机制清点」](https://github.com/0xnicholas/daypaw-pro/issues/32) 的成果。日期：2026-08-22。调查对象：**本仓库当前树**（main @ `cc2217074b`）。交付目标（票面引 2026-08-22 架构目标校准会话）：「外部客户拿代码自跑、客户无宿主、要可直跑产物」。本文只清点事实与缺口，不做选型裁决——裁决归下游 grilling 票。一手来源为仓库自身代码与文档，引用一律为仓库内路径。

## 1. bundle 机制（`packages/bundle/`）

### 物理形态

bundle 是 **npm 包**（目录形态，非单文件）：manifest 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，实质内容是该 patch 列表，部分 bundle 另带 patch 所挂的运行时 glue 插件（`packages/bundle/README.md:5`）。类型定义见 `packages/boot/app-boot/src/profile.ts:42-45`（`DshBundleManifest`）。仓库内三个 in-box bundle：`base/`（共享核心，纯 patch）、`web-app/`（patch + glue 插件）、`headless/`（一次性任务模式）。以 base 为例：`packages/bundle/base/package.json:36-40` 声明 `dsh.bundle`，`files` 字段（:29-34）把 `cordis.patch.yml` 纳入发布内容，`publishConfig.access` 为 `public`（:5-7）。

patch 语义：profile 组合从**空 entry 列表**出发，按 `dsh.profile.bundles` 顺序逐层应用各 bundle 的 patch，再应用用户层与 launcher 层（`packages/boot/app-boot/src/profile.ts:1-22` 模块注、`:413-420` `composeEntries` 调 `applyEntryPatches`）。patch 对目标行是**整行 config 替换**而非 merge（`packages/bundle/base/cordis.patch.yml:6-10` 头注）。

### 安装与解析路径

profile 是 `$DSH_HOME/profiles/<name>/` 目录：`package.json`（out-of-tree 插件依赖 + `dsh.profile.bundles` 有序列表）+ `cordis.patch.yml`（用户 patch 层）+ `pnpm-workspace.yaml`（hoisted linker，`profile.ts:138-143`）。`DSH_HOME` 默认 `~/.dsh`，同名环境变量覆盖（`packages/util/home-paths/src/index.ts:14-20`）。

模块解析为**双锚点**：bundle 名先从 dsh installation（launcher 自身包）解析，再从 profile 目录解析（`profile.ts:344-355` `resolveBundleDir`）——installation 优先是「in-box bundle 永远来自同一安装」的契约。Loader 的 `baseUrl` 是 profile 目录；launcher 维护的扁平 fallback `$DSH_HOME/profiles/node_modules`（installation app 依赖闭包 BFS 每包一个 symlink，含 peerDependencies）让 in-box 插件经 Node 父目录查找从任意 profile 可解析，并保证 out-of-tree 插件的 peer（Service Definition 包）解析到 installation 的单一 cordis 实例（`profile.ts:204-255` `healProfilesModuleFallback`）。

`--profile` 加载路径：`loadProfile`（`profile.ts:371-403`）。`web`/`headless` 两个模板 profile 首次使用自动初始化（`PROFILE_TEMPLATES`，`profile.ts:114-117`）；任何其他名字的 profile 必须先经 `dsh plugin` 创建，否则报错（`profile.ts:378-382`；`apps/cli/README.md:16`）。

### 能否携带任意包（含第三方定义包/插件）

**可以，机制对包来源无约束。** 任何 manifest 声明了 `dsh.bundle` 的 npm 包都是 bundle，不要求它在 dsh 官方依赖里。`dsh plugin --profile <name> <pnpm args>` 是一个 pnpm 转发器（`apps/cli/src/plugin.ts:120-158` `runPlugin`）：在 profile 目录里跑 pnpm，然后按**安装后状态** reconcile——解析到声明 `dsh.bundle` 的依赖即加入 layer 栈，被移除或失去声明的依赖即移出（`plugin.ts:59-91` `reconcilePlugins`）。支持的 spec 形态：registry 名、git、绝对路径、`file:`/`link:`；相对路径 spec 会被重锚到调用目录（`plugin.ts:104-112` `anchorPathSpec`）。无 `dsh.bundle` 声明的包也可装为 profile 普通依赖（仅警告，`plugin.ts:70-75`）。patch 行引用的插件包名从 profile `node_modules` 或 installation fallback 解析。

**对 daypaw 的缺口**：`@daypaw/{store,engine,sdk}` 是 `private: true`、`0.0.0` 的 workspace 包（`packages/daypaw/*/package.json`），不能照现状经 registry 分发；可走的路径是发布它们（需去 private + 版本线）、以 git/file spec 安装、或把其构建产物打进某个 bundle 包的依赖里——三条都是机制允许、但当前均未铺好的路。此外全部上游包名在 `@deepseek-ai` scope 下且上游已在 npm 占用并持续发布该 scope（见 §2），fork 自发布整套包需要 scope/命名决策。

## 2. `apps/cli` 的构建/分发形态

### 构建与发布配置

构建：`tsc -b` 出 `lib/types/`，tsdown 以 `lib/types/bin.js` 为入口打 ESM bundle 回 `lib/`（`apps/cli/tsdown.config.ts`；产物为 `lib/bin.js` 加若干按模式拆分的 chunk，本机实测 bin.js 仅 12K——重逻辑全在依赖包里，CLI 自身是薄 launcher）。发布配置：`name: @deepseek-ai/dsh`、`bin: { dsh: "lib/bin.js" }`、`files: ["lib/*.js", "config"]`、`publishConfig.access: public`（`apps/cli/package.json:2-21`）。

### npm 分发：已设计、且上游已实操

release 序列「dsh family = `packages/` + `apps/` 全部包、单一版本线」（`scripts/release/families.ts:1-10`；`.github/workflows/release.yml` 头注：PR/master 上无凭证打包验证，发布是 `dsh-v*` tag 上的手动 dispatch，`scripts/release/publish.ts` 按 registry 状态逐包决定发布/跳过/失败）。npm registry 实测已有 `@deepseek-ai/dsh` 发布记录（`npm view` 见到 `0.1.1-rc.2`）——**npm 全局安装分发是该 CLI 的设计形态且已被上游证明**。注意本 fork 根版本为 `0.1.0-rc.5`，落后于上游已发布版本；fork 侧自身从未跑过该 release workflow（fork CI 已裁剪为 daypaw-gate，见 `git log` `02c56b3c87`/`68f71e7fe0`）。

### `--profile` 如何指向 bundle

`--profile <name>` 指向 `$DSH_HOME/profiles/<name>` **目录**，不直接接受 bundle 名或路径；bundle 层列表住在该目录 `package.json` 的 `dsh.profile.bundles` 里（§1）。入口模式表见 `apps/cli/README.md:9-16`（`--profile` / `--profile headless "job"` / `dsh web` / `dsh plugin`）。

### 运行时依赖（npm 安装形态下）

Node `^22.19.0 || >=24.0.0`（根 `package.json` engines）。`dsh plugin` 子命令需要系统 `pnpm`（`apps/cli/src/plugin.ts:129-141`，ENOENT → 127 并提示安装 pnpm）；profile 装好后纯 boot 不需要 pnpm。CLI 依赖闭包含 native 模块 node-pty（经 `dsh-subprocess-local`），影响见 §4。

**缺口**：客户无宿主意味着 fork 需自建分发渠道（公共/私有 registry 或 tarball）；`workspace:^` 协议在发布时由 release 流程处理（上游已证明），但 fork 未实操；profile 初始化依赖模板 bundle 从 installation 解析，npm 全局安装形态下该路径由 fallback symlink 机制承担，fork 侧无验证记录。

## 3. 单文件 exe 先例（`scripts/build-exe-for-python-sdk.ts`）

### 技术路线

`@yao-pkg/pkg@6.21.0` 的 `--sea`（enhanced SEA）模式，版本 pinned（`scripts/build-exe-for-python-sdk.ts:25`）。设计裁决与实测记录在 `.agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md`：pkg 在官方 SEA 底座上加 `/snapshot` VFS 与运行时模块 hook，ESM 入口原样交 Node 默认 ESM loader，无 ESM→CJS 转译；实测（macos-arm64/node24）VFS 内 bare-specifier ESM 动态 import（含 TLA）、CJS interop、`node:sqlite`、集外包名 fail-loud、VFS 外 on-disk ESM import 全部通过。**裸 Node SEA 被明确否决**：注入脚本须单 CJS 文件、blob 无文件系统与模块解析，bare specifier 动态 import 无可解析对象（该 note Alternatives）。pkg 标准模式也被否决（esbuild 转 CJS + 动态 import 全抛 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`，同 note）。

### 打包对象与流程

闭包唯一事实源是 `python/sdk-runtime/package.json`（`dsh-jsonrpc-agent-pkg`：零代码纯依赖 manifest，100+ 行 workspace 依赖；「exe 带哪些插件 = 该 manifest 加一行依赖 + 重打包」），`scripts/verify-runtime-closure.ts` 在 hygiene/CI/打包前校验 peer 闭包。流水线（`build-exe-for-python-sdk.ts`）：闭包校验 → `pnpm run build` → `pnpm deploy --legacy --prod`（hoisted、不自动装 peer）直接进 Python runtime 的 `node/` carrier 目录 → 恢复 legacy deploy 漏掉的直接依赖 → **物化全部 symlink**（产物必须无符号链接）→ 注入 pkg 配置（`bin` + 全量 asset globs，因动态 import 对 pkg 静态分析不可见）→ 按 target 备 node-pty addon → 每个 target 一次 `pkg --sea`。

### 产物形态、大小与限制

产物 `dsh-jsonrpc-agent-pkg-<platform>-<arch>` 单文件，**约 174MB**（note Consequences），平台覆盖 linux/macos × x64/arm64，target node24（`--sea` 要求 ≥node22）；**Windows 是 documented non-goal**。macOS 需旁挂 `-spawn-helper` 并对主产物 ad-hoc 签名；Linux 在 manylinux 2.28 容器内重建 node-pty 并校验 GLIBC 上界（`.github/workflows/build-exe-for-python-sdk.yml:185-216`）。核心限制：**插件集封闭**——VFS 里装了什么就是全集，外部 `cordis.yml` 只决定挂哪些（exe 本身不内置配置，由 `DSH_CORDIS_CONFIG`/argv 显式供给）；集外裸名 fail-loud；加载 VFS 外的用户插件列为 future evolution（需另解外部插件与 exe 内 cordis 实例共享）。源码原样进 blob，无字节码混淆（闭源分发需求需另评估）；pkg 的 VFS/hook 层为社区维护。

### `python/` 上下文

该先例服务于 Python SDK 分发：`python/sdk`（client）+ `python/sdk-runtime`（carrier，数据目录带默认 `cordis.yml`、exe、`node/` 闭包树），见 `python/README.md`。exe 是生产 carrier；`node/` 闭包是开发验证 carrier（需显式 `DSH_RUNTIME_MODE=node` + 系统 node ≥22.19），不进 wheel。

**对 daypaw 的关键事实**：此路线打的是 JSONRPC serving 面（`dsh-sdk-jsonrpc-demo` bin + 外部 `cordis.yml`），**不经过 profile/bundle 体系**——exe 路线与 §1 的 profile 路线是两条不同的组合路径（裸 `cordis.yml` 叶子 vs profile patch 层）。把 daypaw 打进 exe 的先例动作是「往闭包 manifest 加依赖」，但 `@daypaw/*` 为 private workspace 包，进 `pnpm deploy` 闭包的路径（`link-workspace-packages=true` 已在用）未被现有闭包覆盖验证。

## 4. 容器化路径

### 现状：无运行时容器先例

全仓库 Glob `Dockerfile*` 零命中，无 `.dockerignore`。容器在 CI 中的唯一用途是 manylinux 2.28 **打包环境**（`.github/workflows/build-exe-for-python-sdk.yml:185-216` 重建 node-pty、`:295` 在 manylinux 容器内跑 wheel 冒烟）——不是 dsh 运行时镜像先例。

### dsh 运行时的最小依赖集（从源码推断）

- **Node `^22.19.0 || >=24.0.0`**（根 `package.json` engines）。`node:sqlite` 内置模块在运行路径上（session-query-sqlite 等；exe 实测通过）。
- **pnpm**：仅 `dsh plugin` 管理 profile 插件时需要（§2）；boot 已装好的 profile 不需要。
- **node-pty**：`dsh-subprocess-local` 的硬 `dependencies`（`packages/subprocess/subprocess-local/package.json:45`），该包在 dsh-base bundle 与 apps/cli 的依赖闭包内。node-pty 1.1.0 官方 prebuilds 只有 darwin/win32（本机 `node_modules/.pnpm/node-pty@1.1.0_*/node_modules/node-pty/prebuilds` 实测无 linux 目录），**Linux npm 安装从源码构建**（`build-exe-for-python-sdk.ts:411-415` 注释）→ 干净 Linux 环境安装需要 node-gyp 工具链（python3/make/g++）或预置 `pty.node`。仓库补丁 `patches/node-pty@1.1.0.patch`（经 `pnpm-workspace.yaml:71-72` patchedDependencies 应用）只改 spawn-helper 路径解析（`DSH_NODE_PTY_SPAWN_HELPER` 环境变量 / execPath 旁挂），服务于 embedded runtime；npm 消费者拿不到此补丁，但常规安装下未补丁 node-pty 可正常工作。
- **landlock-run**：`bash-sandbox`/`sandbox-local` 的硬依赖但**运行时可选**——平台包用 npm `os`/`cpu` 字段分发、无安装期构建兜底，无匹配平台包时 probe 报 `unusable`、消费者 fail-closed 走其他 backend（`native/landlock-run/README.md`）。Linux-only，不构成干净环境阻碍；但 Linux 容器内 Landlock 可用性依赖内核 5.13+ 与容器 LSM 配置，未验证。
- **pwsh**：base patch 的 pwsh 行以 `!!js process.platform` 条件禁用（`packages/bundle/base/cordis.patch.yml:184-186`、`:214-216`），非 Windows 不挂载 → Linux 容器不需要 pwsh。
- **沙箱 backend**：Linux 上为 bwrap/Landlock（`packages/shell/bash-sandbox/README.md`），容器内可用性均未验证。

**缺口**：无 Dockerfile 先例意味着 base image 选型、node-pty 工具链或预构建策略、`$DSH_HOME` 卷/持久化布局、沙箱 backend 在容器内的行为，全部无已验证答案。运行时依赖集可推断（Node + node-pty 是唯二的硬安装期关注点），但「dsh 在干净容器里 boot」这一路径本身没有任何已执行的证据。

## 5. 三种候选形态的事实缺口与风险对照

### npm bundle + CLI

机制最成熟：bundle 的 npm 分发是设计形态（manifest 约定 + pnpm 转发安装 + reconcile），CLI 的 npm 发布链路被上游实操证明（registry 已有版本），bundle 可携带任意来源的包。缺口/风险：① `@daypaw/*` private 未发布，分发前需解决发布或随 bundle 打包；② 全部包名在 `@deepseek-ai` scope 且上游占用中，fork 自发布需 scope 决策；③ fork 从未跑过 release workflow；④ 客户侧需 Node + pnpm 环境与多步安装（install CLI → profile init → add bundle），非「单文件直跑」；⑤ fork 版本线落后上游已发布版本，registry 侧版本协调未定。

### 单文件 exe

技术可行性被 Python SDK 先例完整验证（ESM/VFS/`node:sqlite`/native addon/多平台 CI 全测过），是唯一有端到端证据的「客户无 Node 直跑」形态。缺口/风险：① 先例打的是 JSONRPC serving 面，不是 dsh CLI/profile 体系——profile 的 `$DSH_HOME` 目录模型、pnpm 插件管理与 exe 的封闭 VFS 语义存在张力，「exe + profile」无先例；② 插件集封闭，客户自加插件须重打包；③ ~174MB 体积、源码无混淆（闭源交付需另评估）；④ 无 Windows；⑤ pkg 社区维护层 + 每 target 一次构建的供应链/成本事实；⑥ daypaw 包进闭包未验证。

### 容器镜像

仓库零基础：无 Dockerfile、无运行时镜像 CI。事实底座最薄——运行时最小依赖集可从源码推断（Node 版本 + node-pty 的 Linux 源码构建是唯二硬关注点，landlock-run/pwsh 均运行时可选或条件禁用），但「干净容器内 boot dsh」无任何已执行证据，沙箱 backend 在容器内的可用性未验证。缺口/风险：① 一切需新建（Dockerfile、镜像 CI、发布渠道）；② node-pty 需工具链或预构建策略；③ Landlock/bwrap 在容器 LSM 下行为未知；④ `$DSH_HOME` 持久化与多实例形态无设计。
