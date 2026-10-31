# 201-dsh-market 技术方案

> 本文档为 dsh-market 集成的技术实现方案。
> Module: 201-dsh-market
> 对应规格: [spec.md](./spec.md)
> 对应任务: [tasks.md](./tasks.md)
> 对应测试: [test-cases.md](./test-cases.md)
> Status: Implemented（已实现并打包验证通过）
> Last Updated: 2026-08-25

## 1. 技术上下文

### 1.1 运行时环境

- 运行于 **Electron 主进程**（Electron `^43.4.0`，内置 Node 24；但 `RunAsNode` fuse 关闭，不可复用 Electron 为 Node）。
- dsh Host 与 dsh-market 均在主进程内运行（dsh-market 是 dsh Host 的 in-process 插件）。
- 打包产物：`dsh-dist/`（dsh 部署产物，`extraResource`）+ 新增 `runtime/`（便携 Node + pnpm，`extraResource`）。

### 1.2 依赖

| 依赖 | 版本/来源 | 用途 |
|------|-----------|------|
| dsh-market | 同级源码引用（`../dsh-market`，非 submodule；仓库 dsh-market/dsh-market，tag v1.26.0） | 内置插件市场（构建 `lib/` + `client/`） |
| deepseek-harness（dsh） | 同级源码引用（`../deepseek-harness`，tag dsh-v0.1.1-rc.2） | `dsh plugin`（`apps/cli/src/plugin.ts`）、`dsh.client` 机制、`cordis.patch.yml` 补丁层、`dsh-dist/lib/bin.js` |
| 便携 Node.js | 官方发行版 Node 24 LTS（构建期下载） | 运行 `dsh-dist/lib/bin.js`（`dsh plugin`） |
| pnpm（standalone） | `@pnpm/exe` / 官方 release 单二进制，pnpm 9.x | 实际装包引擎 |

> **构建前置**：`../dsh-market` 与 `../deepseek-harness` 必须在编译前存在于本工程同级目录。`scripts/build-dsh.mjs` 构建 dsh 后会构建 dsh-market（缺 node_modules 时 `npm install` + `npm run build`，缺失目录仅告警跳过）；`scripts/collect-dsh.mjs` 物化 dsh-market 时若目录缺失则**硬失败**（打包必需）。CI 在 `.github/workflows/ci.yml`、`release.yml` 中通过 `Checkout dsh-market (sibling)` 步骤 `git clone --depth 1 --branch v1.26.0 https://github.com/dsh-market/dsh-market.git ../dsh-market`（与 `Checkout dsh (sibling)` 并列）。

## 2. 宪法合规检查

| 原则 | 状态 | 说明 |
|------|------|------|
| 架构：零上游改动 | ✅ | 不改 dsh-market 与 dsh 源码；仅本地 patch（沿用已有 `DSH_DISABLE_HMR`） |
| 架构：只写装配代码 | ✅ | 内置=构建+收集+patch 注入；通道=PATH 注入 + shim 生成，无业务逻辑 |
| 架构：进程内 Host | ✅ | 维持进程内 Host；dsh-market 在进程内运行 |
| 安全：只绑回环地址 | ✅ | 沿用；市场 API 仅同源 loopback |
| 安全：不擅自重启 | ✅ | 注入 `allowRestart: false`，市场不 spawn 独立 dsh 进程 |
| 安全：RunAsNode 保持关闭 | ✅ | 便携 Node 独立内置，不复用 Electron 为 Node |
| 代码质量：TypeScript strict / 无 as any | ✅ | 新增 `runtime.ts` 仅用 node:fs/path/child_process 类型安全 API |
| 代码质量：源码即真理 | ✅ | dsh-market/dsh 关键接口均标注源码文件+行号 |
| 生命周期：优雅关闭 | ✅ | 不引入新常驻进程；pnpm/dsh 子进程由市场 15min 超时 + 取消兜底 |

> 合规结论：全部 ✅，无 ❌。

## 3. 研究结论

### 3.1 关键决策与理由

| 决策 | 理由 |
|------|------|
| 内置方式 = patch 注入 + 物化 | dsh-market 自身 `cordis.patch.yml` 为 `- insert: [{id: dsh-market, name: dshmarket}]`；profile 的 patch 注入该行并内联 `config`，比走 bundle reconcile 更直接 |
| 便携 Node = 官方 Node 24 LTS | 匹配 Electron 43 内置 Node 24 与 dsh 的 Node 24+ API；独立内置，不碰 `RunAsNode` |
| pnpm = standalone 单二进制（9.x） | 无需 Node 即可运行；`plugin.ts` 用 `spawnSync('pnpm', …, shell:win)`；pnpm 10 会拦截 git 依赖构建脚本（源码注释已警告），9.x 规避 |
| PATH 注入 = 运行时写 `dsh` shim 到 userData | 最终安装路径构建期未知，需运行时生成；resources 只读（deb/rpm），写入落 userData |
| profile 注入 desktop + allowRestart:false | 市场默认 profile 为 `web`（`config?.profile ?? argvProfile() ?? 'web'`），必须显式指定；桌面壳拥有进程生命周期 |
| HMR 降级接受 | `DSH_DISABLE_HMR` 下市场热开关/免重启安装退化为重启生效，桌面关窗即退、重开即生效 |

### 3.2 源码级核实

- dsh-market 安装/删除底层 = spawn `dsh plugin --profile <p> add|remove <t>`：`src/dsh-cli.ts:283-295`（`dshArgv`）、`:769-846`（`runDshPlugin`）。
- `dshArgv()` 回退 PATH `dsh`：`process.argv[1]` 匹配 `/bin\.(js|ts)|dsh$/` 否则 PATH `dsh`；Windows 经 `cmd.exe /d /s /c`（`:263-295`）。
- `dsh plugin` = profile 目录 `spawnSync('pnpm', …, shell:win)` + `reconcilePlugins`：`apps/cli/src/plugin.ts:120-158`。
- `@deepseek-ai/dsh` bin = `dsh → lib/bin.js`：`apps/cli/package.json`。
- 市场 profile 解析与 Desktop 契约：`dsh-market/src/index.ts:59-108`（`desktopProfiles` 缺失时走 `config.profile ?? argvProfile() ?? 'web'`）。
- dsh 插件加载/bundle/patch 机制：`vendor/include/src/index.ts`（PatchOptions/insert）、`packages/boot/app-boot/src/profile.ts`、`apps/cli/src/profile-boot.ts`（见 explore 结论）。

### 3.3 Oracle 结论（便携 Node + pnpm 打包）

1. **便携 Node**：构建期下载官方 Node zip/tar.xz，规范化到 `runtime/node/bin/`，`extraResource: ['dsh-dist', 'runtime']`。Linux 打包可能丢失 +x，运行时 `chmodSync(0o755)` 兜底。
2. **pnpm**：standalone 单二进制（`pnpm-win-x64.exe` / `pnpm-linuxstatic-x64`，pnpm 9.x），置于 `runtime/pnpm/`，无需 `.cmd` shim（Windows `cmd.exe` 经 PATHEXT 解析 `pnpm.exe`）。
3. **dsh shim**：运行时在 `userData/runtime-bin/` 生成 `dsh.cmd`（win）/`dsh`（posix，`chmod 755`），内容 `"<node>" "<dsh-dist>/lib/bin.js" %*`（`"$@"`），前置 PATH。
4. **不启用 RunAsNode**：Electron V8 `-electron` 分支 ABI 缺失（`GetAlignedPointerFromEmbedderData`，已在本工程 loader 触发）；`corepack`/`npm` 在 electron.exe 旁不可达；安全回归。
5. **接线**：新增 `scripts/fetch-runtime.mjs`（下载 Node+pnpm）+ `src/main/runtime.ts`（`setupBundledRuntime()`），在 `whenReady` 内、`startHost()` 前调用。

## 4. 数据模型

### 4.1 新增实体

| 实体 | 位置 | 说明 |
|------|------|------|
| 便携 Node | `runtime/node/bin/node[.exe]`（extraResource） | 运行 dsh CLI |
| pnpm | `runtime/pnpm/pnpm[.exe]`（extraResource） | 装包引擎 |
| dsh shim | `userData/runtime-bin/dsh[.cmd]`（运行时生成） | 使 PATH `dsh` 可解析 |
| dsh-market 产物 | `dsh-dist/node_modules/dshmarket/`（打包）/ 开发态解析路径 | `lib/`+`client/`+`cordis.patch.yml`+`package.json` |
| 市场运行配置 | profile `cordis.patch.yml` 注入行 | `config: { profile: 'desktop', allowRestart: false }` |

### 4.2 状态与持久化

- profile manifest：`$DSH_HOME/profiles/desktop/package.json`（`dependencies.dshmarket` + `dsh.profile.bundles`）。
- profile 补丁：`$DSH_HOME/profiles/desktop/cordis.patch.yml`（注入市场行 + 既有 web-runtime 覆盖）。
- 市场运行时状态：`$DSH_HOME/profiles/desktop/.dsh-market/state.json`（由 dsh-market 自管，本模块不碰）。

## 5. 接口契约

### 5.1 新增/扩展

| 模块 | 符号 | 说明 |
|------|------|------|
| `scripts/fetch-runtime.mjs`（新） | 脚本 | 下载便携 Node + standalone pnpm 到 `runtime/`，幂等 |
| `scripts/collect-dsh.mjs`（扩展） | 脚本 | 物化 dsh-market 产物到 `dsh-dist/node_modules/dshmarket` |
| `src/main/runtime.ts`（新） | `setupMarketRuntime()` | chmod 运行时 + 写 dsh shim + 前置 PATH（开发态写 dsh shim 指向 sibling dsh 源码；打包态写便携 node + dsh-dist） |
| `src/main/index.ts`（扩展） | 调用 | `whenReady` 内、`startHost()` 前调 `setupMarketRuntime()` |
| `profiles/desktop/package.json`（扩展） | manifest | 加 `dshmarket` 到 dependencies + bundles |
| `profiles/desktop/cordis.patch.yml`（扩展） | patch | insert 市场行 + config |

### 5.2 消费接口（上游）

- `dsh plugin` CLI：经 `dsh-dist/lib/bin.js`（本模块仅保证其可执行与 pnpm 可解析）。
- dsh-market 的 `/dsh-market/*` 路由：由 dsh-market 自行挂载（本模块不介入）。

## 6. 实现策略

### 6.1 架构模式

**装配 + 运行时引导**：构建期（fetch-runtime + collect-dsh）准备产物；运行期（runtime.ts + profile patch）注入路径与配置。不修改上游，仅装配。

### 6.2 关键算法

- **PATH 前置**：`process.env.PATH = [userData/runtime-bin, resources/runtime/pnpm, 原 PATH].join(sep)`，在 `startHost()` 前执行；市场 `spawnEnv()` 从 `process.env.PATH` 读取并 `...process.env` 继承给子进程（`dsh → node bin.js → pnpm` 链全继承）。
- **shim 生成**：win 写 `dsh.cmd`（`@echo off` + `"<node>" "<bin.js>" %*`）；posix 写 `dsh`（`#!/bin/sh` + `exec "<node>" "<bin.js>" "$@"`，chmod 755）。每次启动覆盖写（幂等、自愈路径变更）。
- **物化 dsh-market**：复制 `lib/`、`client/`、`cordis.patch.yml`、`package.json`（排除 node_modules），与 `collect-dsh.mjs` 现有 `copyPackage` 同理。

### 6.3 错误处理

- 便携 Node/pnpm 下载失败：`fetch-runtime.mjs` 大声失败（构建期）；运行期缺失时市场安装会走 ENOENT，`runtime.ts` 记 warn 但不阻塞 Host 启动。
- chmod 失败：POSIX 下 catch 并 warn（deb 打包的只读场景）。
- 开发态（`!isPackaged`）：`setupBundledRuntime()` 跳过运行时注入，依赖开发机已有 Node/pnpm（市场 `provisionPnpm` 兜底）。

### 6.4 性能

- 便携运行时不参与启动（仅市场首次安装时 spawn）；shim 生成是极小 fs 操作，一次启动一次。

## 7. 测试考虑

- **类型检查**：`npm run typecheck`。
- **单元**：`runtime.ts` 的 shim 内容生成、PATH 拼接；`collect-dsh.mjs` 的 dsh-market 物化（排除 node_modules）。
- **集成**：`npm start` 后设置页出现「插件市场」；安装/卸载/开关/主题全链路（开发态）。
- **打包冒烟**：`npm run make` 后 resources 含 runtime + dsh-dist；打包应用在市场安装插件成功（便携 Node+pnpm 通道）。
- 详见 [test-cases.md](./test-cases.md)。

## 8. 文件清单

| 文件 | 用途 |
|------|------|
| `package.json` | version 0.1.1；新增 `fetch:runtime`、扩展 `prepackage`/`premake` |
| `forge.config.ts` | `extraResource: ['dsh-dist', 'runtime']` |
| `scripts/fetch-runtime.mjs`（新） | 下载便携 Node + pnpm 到 `runtime/` |
| `scripts/collect-dsh.mjs`（改） | 物化 dsh-market 产物到 `dsh-dist/node_modules/dshmarket` |
| `src/main/runtime.ts`（新） | `setupBundledRuntime()`：chmod + shim + PATH |
| `src/main/index.ts`（改） | 调 `setupBundledRuntime()` |
| `src/main/host.ts`（改） | 确保 dshmarket 可解析（symlink/物化）；`ensureProfilePluginLinks` 链接用户插件顶层 + `.pnpm/node_modules` 传递依赖到 dsh 根 node_modules |
| `profiles/desktop/package.json`（改） | 加 dshmarket 依赖 + bundle |
| `profiles/desktop/cordis.patch.yml`（改） | insert 市场行 + config |

## 9. 与规格的交叉引用

| 规格需求 | 实现位置 |
|----------|----------|
| FR-201-001（版本 0.1.1） | `package.json` version |
| FR-201-002/003（内置与依赖） | `fetch-runtime`/`collect-dsh` 扩展 + dshmarket 物化 |
| FR-201-004/005（bundle + config 注入） | `profiles/desktop/package.json` + `cordis.patch.yml` |
| FR-201-006（client bundle 服务） | dshmarket `dsh.client` + 物化 `client/` |
| FR-201-007/008/009/010（安装通道） | `runtime.ts` + `dsh` shim + PATH + `dsh-dist/lib/bin.js` + pnpm |
| FR-201-011/012（配置持久化、HMR 降级） | 市场自管 patch/state；`allowRestart:false` + `DSH_DISABLE_HMR` |

## 10. 实现偏差与调试记录（As-built）

> 实现过程中相对原方案的调整与实测踩坑，作为维护基线。详细 Bug 表见 [spec.md 第 9 节](./spec.md#9-实现与调试记录as-built)。

### 10.1 与原方案的差异

| 项 | 原方案 | 实际实现 | 原因 |
|----|--------|----------|------|
| 运行时引导函数名 | `setupBundledRuntime()` | `setupMarketRuntime()` | 命名收敛到市场语义；同时覆盖开发态与打包态 |
| 开发态 dsh shim | 方案称开发态跳过运行时注入、依赖系统 Node/pnpm | 开发态也写 `dsh` shim（指向 sibling dsh 源码 `apps/cli/lib/bin.js`）并前置 PATH | 市场 `dshArgv()` 回退 PATH `dsh`，开发态同样需要可解析的 `dsh` 命令才能走安装通道 |
| dshmarket 运行时依赖 | 仅物化 lib/client | 递归复制 dshmarket 的生产依赖（undici、js-yaml、argparse 等，含传递依赖），`@deepseek-ai/*` 从宿主解析 | npm 扁平布局下这些传递依赖不在 dsh 根 node_modules，不复制则开发态市场 host 端 import 失败 |
| profile 升级 | 整目录 `cpSync` 覆盖 | 合并策略（仅补齐缺失种子依赖/bundle，保留用户插件） | 覆盖会抹掉用户通过市场安装的插件（Bug-1） |
| 用户插件解析 | 假设 dsh `healProfilesModuleFallback` 覆盖 | 新增 `ensureProfilePluginLinks`，链接顶层 + `.pnpm/node_modules` 传递依赖 | dsh fallback 只覆盖 install anchor 闭包，不含用户新装插件及其传递依赖（Bug-2/4） |
| pnpm 形态 | 方案倾向 standalone 单二进制 | 实际使用 pnpm 9.15.9（npm tarball 布局 `pnpm/{bin,dist,...}` + `pnpm.cmd`） | 国内网络下经 npmmirror 获取该布局并验证可用；未强制单二进制 |

### 10.2 打包态关键路径（实测）

- 便携 Node：`resources/runtime/node/`（Windows: `node.exe` 在根；Linux/macOS: `bin/node`；v24.11.1）。
- 便携 pnpm：`resources/runtime/pnpm/` 下的单二进制（Windows: `pnpm.exe`；Linux/macOS: `pnpm`，chmod 755；9.15.9），PATH 前置后市场 `spawnSync('pnpm')` 命中。
- dsh shim：运行时写入 `userData/runtime-bin/`（Windows: `dsh.cmd`；POSIX: `dsh`），内容为 `"<便携node>" "<resources>/dsh-dist/lib/bin.js" %*`（POSIX 用 `exec ... "$@"`）。
- dshmarket 物化：`resources/dsh-dist/node_modules/dshmarket/{lib,client,package.json,cordis.patch.yml}` + 其 `node_modules` 运行时依赖。
- profile 插件链接：`ensureProfilePluginLinks()` 在 `runProfile` 前执行，先清理悬空 junction/symlink，再链接 profile 顶层与 `.pnpm/node_modules` 到 `dsh-dist/node_modules`。

> 跨平台资产（`scripts/fetch-runtime.mjs`）：Windows 用 Node `.zip` + `pnpm-win-{arch}.exe`；Linux 用 Node `.tar.xz` + `pnpm-linuxstatic-{arch}`；macOS 用 Node `.tar.gz`（官方无 .tar.xz）+ `pnpm-macos-{arch}`。均经 `tar -xf` 解压（自动识别 gzip/xz），`arch` 取 `arm64` 或 `x64`。

### 10.3 collect-dsh 健壮性调整

- `collect-dsh.mjs` 对 dshmarket 物化失败改为 hard-fail（而非静默跳过），避免打包出「能启动但市场缺失」的残缺产物。
- 物化后清理非目标架构的原生模块 prebuilds（darwin/linux/arm），避免 Linux 打包 rpm strip 失败（前期修复）。

### 10.4 网络构建说明

`fetch-runtime.mjs` 默认从 nodejs.org / GitHub releases 下载，在本机直连挂死；实测通过 npmmirror 镜像下载 Node zip 与 pnpm tarball，按 `runtime/` 预期布局放置并写入 `.versions.json` 后，`fetch-runtime` 幂等跳过。脚本逻辑未改，后续建议加入镜像回退（见 spec 9.6 遗留项）。
