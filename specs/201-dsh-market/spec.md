# dsh-market 集成 功能规格

> Module: 201-dsh-market
> 需求编号: 201-dsh-market
> Status: Implemented（已实现并打包验证通过，2026-08-25）
> Git 分支: spec/201-dsh-market
> Last Updated: 2026-08-25

## 1. 模块概述

### 1.1 目的（Why this module exists）

把 [dsh-market](https://github.com/dsh-market/dsh-market)（DeepSeek Harness 的可视化插件市场）**内置**到本桌面工程封装的 deepseek-harness（dsh）环境中，使其随 Host **自动加载**，并让用户能在桌面应用内**安装、删除、配置插件**——开发模式与打包应用均可用。

dsh-market 是一个前后端混合的 Cordis 插件（npm 包 `dshmarket`，当前 tag `v1.26.0`）：宿主端（`src/`）挂载 `/dsh-market/*` HTTP 路由、读写 profile 目录、spawn `dsh` CLI；浏览器端（`client/`）注入设置页 UI。本模块负责「把它作为一个插件装进 desktop profile 并打通其安装/删除/配置能力」，**不改 dsh-market 与 dsh 的上游代码**。

### 1.2 解决的问题（What pain points it addresses）

- **零命令行逛/装插件**：桌面用户无需自装 Node/pnpm、无需敲 `dsh plugin --profile web add <name>`，即可在设置页浏览社区目录（1550+ 插件）、一键安装/更新/卸载/开关主题。
- **打包应用的插件管理**：普通 `dsh web` 依赖系统 Node/pnpm 来装插件；打包后的 Electron 应用没有这些运行时，本模块通过内置便携 Node + pnpm + dsh CLI 打通这一通道。
- **profile 正确性**：dsh-market 默认操作 `web` profile，本工程用 `desktop` profile，必须显式注入 profile 名，否则安装会写错目录。

### 1.3 范围（Scope）

**包含**：

- 版本更新：本工程 `package.json` version `0.1.0` → `0.1.1`。
- dsh-market 构建产物（`lib/` + `client/` + `cordis.patch.yml` + `package.json`）的收集与物化（开发态 + 打包态）。
- desktop profile 声明 dshmarket 为 bundle 并注入运行配置（`profile: desktop`、`allowRestart: false`），实现自动加载。
- 便携 Node.js + pnpm + dsh CLI 的内置与运行时 PATH 注入，打通安装/删除/配置通道。

**不包含**：

- 修改 dsh-market 或 dsh 的上游源码（沿用「零上游改动」宪法原则；仅本地 patch 除外）。
- dsh-market 自身功能（目录拉取、备份/WebDAV/Gist、诊断等）的实现——全部由 dsh-market 提供。
- 全局快捷键、开机自启等其它桌面能力（见 `docs/000-产品概念设计.md`）。

## 2. 用户故事

- 作为用户，我希望打开桌面应用后，设置页就能看到「插件市场」，无需任何手动配置。
- 作为用户，我希望在插件市场里浏览、搜索社区插件，一键安装，装完（多数插件）刷新页面即可用。
- 作为用户，我希望卸载插件、开关插件（启用/禁用）、切换主题，且我的选择在重启后保留。
- 作为用户，我希望在**打包安装后的应用**里也能正常安装/删除/配置插件，而不是提示「未安装 pnpm」。
- 作为用户，我希望插件市场不会擅自重启我的桌面应用（重启由桌面壳掌控）。

## 3. 功能需求

### 3.1 版本更新

- FR-201-001：系统 MUST 将本工程 `package.json` 的 `version` 由 `0.1.0` 更新为 `0.1.1`。

### 3.2 dsh-market 内置

- FR-201-002：系统 MUST 构建 dsh-market（`npm install` + `npm run build`，产出 `lib/` 与 `client/`），并将其产物（`lib/`、`client/`、`cordis.patch.yml`、`package.json`，排除 node_modules）物化到 dsh 部署产物目录（开发态可解析路径 + 打包态 `dsh-dist/node_modules/dshmarket`）。
- FR-201-003：系统 MUST 保证 dsh-market 的 peer 依赖（`@deepseek-ai/dsh-settings@^0.1.1-rc.2`、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`）已由 dsh-base/web-app 提供，无需额外安装。

### 3.3 自动加载

- FR-201-004：系统 MUST 使 desktop profile 把 `dshmarket` 声明为 bundle（`dsh.profile.bundles` + `dependencies`），令 dsh-market 的 `cordis.patch.yml`（`- insert: [{id: dsh-market, name: dshmarket}]`）随组合被应用。
- FR-201-005：系统 MUST 在 desktop profile 的 `cordis.patch.yml` 注入运行配置 `config: { profile: 'desktop', allowRestart: false }`，使市场操作正确的 profile 且不擅自重启桌面壳。
- FR-201-006：系统 MUST 使 dsh-market 的浏览器端 bundle 经 `/plugins/dsh-market/client.js` 被服务（复用 dsh 现有 `dsh.client` 机制，双面插件：host 行 + `exports["./client"]`）。

### 3.4 安装/删除/配置通道

- FR-201-007：系统 MUST 在运行时让市场能 spawn `dsh plugin --profile desktop add|remove <target>`（复用 dsh 官方 pnpm 转发 + `reconcilePlugins`）。
- FR-201-008：系统 MUST 内置并暴露 pnpm，使 `dsh plugin` 内部的 `spawnSync('pnpm', …)` 在开发态与打包态均能找到 pnpm。
- FR-201-009：系统 MUST 内置并暴露 dsh CLI 的 Node 运行时，使 `dsh plugin` 命令（`dsh-dist/lib/bin.js`）可执行。
- FR-201-010：系统 MUST 在 dsh Host 启动前完成 PATH 注入，使市场 `dshArgv()`（回退 PATH `dsh`）与 `dsh plugin` 的 pnpm 均能解析。

### 3.5 配置与持久化

- FR-201-011：系统 MUST 支持插件开关（启用/禁用）与主题切换，选择持久化到 profile 的 `cordis.patch.yml` 与市场 state.json，跨重启保留。
- FR-201-012：系统 MUST 接受「HMR 被禁 → 热开关/免重启安装退化为重启后生效」的降级行为（桌面关窗即退、重开即生效）。

## 4. 关键实体

| 实体 | 说明 | 关键属性 |
|------|------|----------|
| dsh-market 产物 | 内置的插件市场包 | `lib/`（host half）、`client/`（browser half）、`cordis.patch.yml`（insert 声明）、`package.json`（name=dshmarket、dsh.client 声明） |
| desktop profile | 加载 dsh-market 的组合 | `dsh.profile.bundles`（含 dshmarket）、`cordis.patch.yml`（注入 config） |
| 便携运行时 | 打包内置的 Node + pnpm | `resources/node`、pnpm（PATH 暴露） |
| dsh CLI | 市场的包操作通道 | `dsh-dist/lib/bin.js`（`dsh plugin add/remove`） |
| 市场运行配置 | 注入的 MarketConfig | `profile: 'desktop'`、`allowRestart: false` |

## 5. 验收场景

### 场景：设置页出现插件市场（自动加载）

- Given 应用启动（`npm start`）
- When dsh Host 就绪、窗口加载
- Then 设置页出现「插件市场」入口，能浏览社区目录；浏览器控制台无「宿主太旧」的自我禁用提示

### 场景：安装插件（开发态）

- Given 开发环境具备 Node + pnpm，市场已加载
- When 用户在市场选择一个可安装插件并确认
- Then `dsh plugin --profile desktop add <target>` 执行成功，插件装入 `$DSH_HOME/profiles/desktop/node_modules`，bundle 清单被 reconcile；刷新/重启后插件生效

### 场景：卸载插件

- Given 某插件已安装
- When 用户两步确认卸载
- Then 插件从 profile 依赖与 bundle 清单移除，市场 state/patch 记录被清理

### 场景：开关/主题持久化

- Given 用户禁用某插件或切换主题
- When 重启应用
- Then 禁用/主题选择保持（写入 `cordis.patch.yml` 与 state.json）

### 场景：打包应用安装插件

- Given 打包应用（`npm run make` 产物）在无系统 Node/pnpm 的机器上运行
- When 用户在市场安装插件
- Then 内置便携 Node + pnpm 使 `dsh plugin add` 正常执行，插件安装成功（不依赖系统环境）

### 场景：市场不擅自重启

- Given 市场需要「重启生效」的场景
- When 触发变更
- Then 市场显示待重启提示，但不 spawn 独立 dsh 进程；由桌面壳关窗/重开完成生效

### 场景：版本号

- Given 已完成版本更新
- When 读取 `package.json`
- Then `version === '0.1.1'`

## 6. 非功能需求

- **性能**：内置便携 Node + pnpm 不应显著拖慢应用启动（仅在市场首次执行包操作时加载运行时）。
- **体积**：便携 Node + pnpm 增加安装包体积（约 30–80MB），属可接受代价（本地打包自用）。
- **可维护性**：dsh-market 作为 sibling 源码引用，随其 tag 迭代；收集逻辑集中在 `collect-dsh.mjs` 一类脚本中。
- **安全**：市场所有 API 仅接受同源 loopback 请求（沿用 dsh-market 既有约束）；`allowRestart: false` 关闭市场的进程重启能力；不启用 Electron 的 `RunAsNode` fuse（维持现有安全加固）。
- **可移植性**：便携 Node/pnpm 的 shim 需在 Windows（`.cmd`）、Linux 与 macOS（POSIX shell 脚本）三平台可用。

## 7. 假设与约束

- **假设**：dsh-market 的安装/删除底层 = spawn `dsh plugin`（已源码核实 `src/dsh-cli.ts:283-295`、`runDshPlugin:769`）。
- **假设**：`dsh plugin` = 在 profile 目录 `spawnSync('pnpm', …)` + `reconcilePlugins`（已源码核实 `apps/cli/src/plugin.ts:120-158`）。
- **假设**：`@deepseek-ai/dsh` 的 `bin` 为 `dsh → lib/bin.js`（已核实 `apps/cli/package.json`）。
- **约束（HMR 已禁）**：本工程打 `DSH_DISABLE_HMR` 补丁，市场的热开关/免重启安装退化为「重启生效」，属可接受降级。
- **约束**：dsh-market 需要 dsh web ≥ rc.7（设置卡片）；内置 dsh `0.1.1-rc.2` 满足。
- **约束**：`RunAsNode` fuse 保持关闭，便携 Node 需独立内置（不复用 Electron 的 Node）。

## 8. 依赖

**上游（被本模块消费）**：

- dsh-market（sibling 源码引用 `../dsh-market`，非 submodule；仓库 https://github.com/dsh-market/dsh-market，tag v1.26.0）——内置对象。构建前必须与本工程同级 checkout；`build:dsh` 会在缺失 node_modules 时 `npm install` 并 `npm run build`，`collect-dsh` 物化其 `lib/`+`client/`+`cordis.patch.yml`+`package.json` 为 `dsh-dist/node_modules/dshmarket`，缺失则打包硬失败。
- deepseek-harness（`../deepseek-harness`，tag dsh-v0.1.1-rc.2）——`dsh plugin` 命令、`dsh.client` 机制、`cordis.patch.yml` 补丁层、`dsh-dist/lib/bin.js`。
- 便携 Node.js + pnpm——打包内置运行时。

**构建/CI 前置**：两个 sibling 仓库都需在编译机上与本工程同级存在。GitHub Actions（`.github/workflows/ci.yml`、`release.yml`）在 checkout 本工程后，分别以 `Checkout dsh (sibling)`、`Checkout dsh-market (sibling)` 步骤 `git clone --depth 1 --branch <tag>` 到 `../deepseek-harness`、`../dsh-market`（`actions/checkout` 的 path 不能越出 `$GITHUB_WORKSPACE`，故用 clone）。

**下游（消费本模块）**：

- `105-upstream-adapter-bundle`：本模块扩展其 `dsh.profile.bundles` 与 `cordis.patch.yml`。
- `115-host`（`startHost`）：本模块在宿主启动前注入 PATH 并暴露 dsh CLI/pnpm。
- 构建脚本（`build-dsh.mjs` / `collect-dsh.mjs`）：本模块扩展其收集 dsh-market 产物与便携运行时。

## 9. 实现与调试记录（As-built）

> 本节记录开发调试中实际遇到并解决的问题，作为后续维护的基线事实。源码即真理；与上文设计描述冲突处以本节与源码为准。

### 9.1 版本与产物（实测）

- 工程版本 `0.1.0 → 0.1.1`；内置 dsh-market 打包态实际版本为 `dshmarket@1.29.2`（collect 时从 sibling `dsh-market` 物化，高于设计时的 v1.26.0 tag）。
- 便携运行时：Node `24.11.1` + pnpm `9.15.9`，置于 `resources/runtime/`；因国内直连 nodejs.org/GitHub releases 挂死/重置，临时经 npmmirror 镜像下载并写入 `.versions.json` 使 `fetch-runtime` 幂等跳过。

### 9.2 两条解析锚点（关键架构事实）

dshmarket 需要在两个不同位置均可被解析，二者缺一不可：

1. **loader/bundle 解析锚点 = `DSH_ROOT/node_modules`**：`cordis-plugin-loader` 位于 `<dsh根>/node_modules/@deepseek-ai/`，用裸 `import('<plugin>')` 加载 bundle，Node 沿 dsh 根目录树向上查找 node_modules。
2. **client 扫描锚点 = profile 目录**：`dsh-client-modules` 以 `baseUrl = profile 目录` 扫描 `dsh.client` 声明来服务 `/plugins/<pkg>/client.js`。

因此 dshmarket 既要出现在 dsh 根 node_modules（开发态 `ensureDshMarketMaterialized`、打包态 collect 物化），也要被链接到 `$DSH_HOME/profiles/node_modules/dshmarket`（`ensureDshMarketProfileLink`，开发/打包均需）。

### 9.3 打包态实测暴露并修复的四个 Bug

均位于 `src/main/host.ts`，按 systematic-debugging 定位根因后修复：

| # | 现象 | 根因 | 修复 |
|---|------|------|------|
| Bug-1 | 安装插件重启后，插件从 profile package.json 消失 | `ensureDesktopProfile` 用「bundles 完全相等」判断是否重拷，用户新装 bundle 与种子不等即整目录 `cpSync` 覆盖，抹掉用户插件 | 改为合并策略：仅补齐缺失的种子依赖/bundle，保留用户追加项；其他种子文件仅缺失时补齐 |
| Bug-2 | 重启后 Host 启动失败 `ERR_MODULE_NOT_FOUND: <plugin>` | 用户插件落在 `$DSH_HOME/profiles/desktop/node_modules`（pnpm 独立树），loader 裸名 import 沿 dsh-dist 树查找找不到；dsh 自带 `healProfilesModuleFallback` 只链接 install anchor 依赖闭包，不含用户新装包 | 新增 `ensureProfilePluginLinks`：runProfile 前把 profile node_modules 顶层包 junction 到 dsh 根 node_modules（nearest-wins） |
| Bug-3 | 卸载后 dsh-dist 残留指向已删包的悬空 junction，`rmSync({force})` 在 Windows 悬空 junction 上报 "Path is a directory" | 清理逻辑被 `if (!existsSync(profileNm)) return` 早退挡住；Windows 悬空 junction 需特殊删除 | 清理无条件前置；用 `readlinkSync`+`existsSync` 识别悬空；`unlinkSync` 删除（不跟随），EPERM/EISDIR 回退 `rmdirSync` |
| Bug-4 | 安装聚合型插件 `@linxin666/dsh-web-ui-all` 后重启，AggregateError 列出 19 个 `ERR_MODULE_NOT_FOUND`（`@linxin666/dsh-client-ui-*`、`dsh-better-sidebar`、`@mlgbnb/dsh-archive-manager` 等） | Bug-2 只链接了 profile node_modules 顶层（直接依赖）；pnpm 把传递依赖放在 `node_modules/.pnpm/node_modules/`（372 个 junction，指向 `.pnpm/<pkg>@ver_hash/node_modules/<pkg>`）。聚合插件的 cordis.patch.yml 把十几个传递依赖声明为 loader entry，loader 裸名 import 全部解析失败 | 抽出 `linkFlatNodeModules(srcNm, destRoot, skipTop?)`，除顶层外额外遍历 `.pnpm/node_modules/` 把全部传递依赖 junction 到 dsh 根 node_modules（nearest-wins，不覆盖 dsh-dist 自带依赖） |
| Bug-5 | macOS（`macos-latest`）`npm run make` 在 fetch-runtime 阶段失败：`unsupported platform: darwin` | `scripts/fetch-runtime.mjs` 的 `nodeAsset()`/`pnpmAsset()` 只处理 win32 与 linux，没有 darwin 分支；而 CI 矩阵含 macos-latest | 增加 darwin 支持：Node 用 `node-v<ver>-darwin-<arch>.tar.gz`（macOS 官方无 .tar.xz），pnpm 用 `pnpm-macos-<arch>` 单二进制；`tar -xf` 自动识别 gzip/xz，解压逻辑复用 POSIX 分支 |

### 9.4 市场 API 契约（从 client bundle 反查）

- 安装：`POST /dsh-market/install`，body `{"url":"<github url>"}`，**必须**带 `Origin: http://127.0.0.1:<port>` 头，否则 403 untrusted origin。
- 卸载：`POST /dsh-market/uninstall`，body `{"name":"<pkg>"}`，同样需 Origin 头。
- 注入配置 `{profile: 'desktop', allowRestart: false}` 实测生效（status 返回 `restart:false`）。

### 9.5 最终打包态验证结论

- 启动日志 `host 就绪: http://127.0.0.1:<port>/`，无 AggregateError / ERR_MODULE_NOT_FOUND。
- `/dsh-market/installed`：`dshmarket` 与 `@linxin666/dsh-web-ui-all` 均 `state=live, hot=true, bundle=true`。
- `/plugins/dshmarket/client.js` → 200（约 442KB）。
- 安装 → 重启生效（含聚合插件十几个传递依赖 loader entry）→ 卸载 → 重启干净，全链路通过。

### 9.6 已知遗留

- `fetch-runtime.mjs` 直连 nodejs.org/GitHub 在国内会挂死，建议增加 npmmirror 镜像回退与进度/重试（当前靠手动镜像 + `.versions.json` 跳过）。
- stderr 有一条非致命警告 `[plugin-manager] cannot determine the boot profile; pass --profile <name> or set DSH_PROFILE`，不影响 Host 启动与插件加载。
- TC-007/008（开关/主题持久化）、TC-201~203（负向/边界：网络失败、损坏插件、版本冲突）、Linux 便携运行时、干净机器冷启动尚未单独验证。
