[English](./README.md) | 中文

---

# DSH Desktop

> 基于 Electron 的 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 桌面封装，提供深度桌面集成体验。

**当前状态**：✅ 脚手架与消费 dsh 已完成——主进程 `runProfile('desktop')` 挂起 dsh Host，渲染进程同源加载 dsh Web UI（托盘/通知等 MVP 能力待接入）。详见 [docs/000-产品概念设计.md](docs/000-产品概念设计.md)。

---

## 这是什么

DeepSeek Harness（`dsh`）是 DeepSeek AI 开源的 agent harness（智能体框架），采用「一切皆插件」的架构，原生入口是 `dsh web`（浏览器 Web UI）。

本项目用 Electron 把 `dsh` 的 Web UI 装进原生桌面壳，补齐托盘、通知等桌面能力，界面功能完全沿用 dsh 标准前端，让 agent harness 像一个真正的桌面应用那样运行——**不是**「包一层 `dsh web` 指向 localhost」的粗壳，而是按 dsh 现有架构实现的一等公民桌面应用。

## 核心设计

`dsh` 已完成 **Host/Client 分层**，且它的 webserver **同时服务 SPA dist 和 `/api`**。因此桌面壳采用**进程内 Host + webserver + localhost 同源数据面**：

```
┌─ Electron 主进程（Node.js，也承载 dsh Host）─────────────────┐
│  runProfile('desktop', ['--port','0']) → { ctx, shutdown }    │
│    ├─ webserver   ← 绑定 127.0.0.1:<空闲端口>，服务 dist + /api│
│    ├─ apiProxy    ← RPC 网关                                  │
│    └─ connection  ← 已把 /api + WebSocket 注册到 webserver     │
│  就绪后 loadURL(`http://127.0.0.1:${ctx.webServer.port}/`)    │
│  ┌─ Tray / Notification：订阅 ctx 的 session/event            │
│  └─ 常规标题栏（系统原生 min/max/close）                     │
└──────────────▲───────────────────────────────────────────────┘
               │ （无窗口控制 IPC；渲染层走 HTTP/WS 同源） │
┌──────────────┴───────────────────────────────────────────────┐
│ 渲染进程：loadURL('http://127.0.0.1:<port>/')  ← 同源          │
│   标准 dsh Web UI（WebApiClient：fetch /api + WS 事件流）      │
└──────────────────────────────────────────────────────────────┘
```

关键点：**渲染进程同源加载 localhost，零 CORS、零鉴权、零自定义协议、零 IPC 载体**——复用 dsh 现有的 `WebApiClient`（HTTP 上行 + WebSocket 下行），**零上游改动**。

## 计划中的 MVP 功能

- ✅ 系统托盘（退出/唤回）
- ✅ 原生通知
- ✅ 常规 Windows 标题栏（系统原生 min/max/close）
- ✅ 剪贴板图片粘贴
- ✅ 窗口状态持久化（最大化/位置尺寸，重启恢复）
- ✅ F11 全屏切换

（暂缓：全局快捷键唤起、开机自启、多窗口；原生文件选择沿用 dsh 标准前端目录浏览）

## 目标平台与分发

- **平台**：Windows + Linux + macOS（Electron 三端通用；macOS 制品与 `make` 同流程产出）
- **分发**：先本地打包自用（Electron Forge `make`）：Windows 出 Squirrel 安装器，macOS 出 DMG（依赖宿主 `hdiutil`，需在 macOS 机器上执行，见 `forge.config.ts`），Linux 出 deb/rpm，并为 `darwin`/`linux`/`win32` 出免安装 ZIP。暂不做自动更新、代码签名、商店分发

## 技术栈

- **Electron** + **Electron Forge**（脚手架与打包）
- **deepseek-harness**（`dsh`，与本工程**同级目录**，非 submodule，引用路径 `../deepseek-harness`；消费方式为本地源码引用）—— 当前构建基于 **`dsh-v0.2.0-rc.2`**，其补丁位于 `patches/dsh-v0.2.0-rc.2/`
- **dsh-market**（与本工程**同级目录**，引用路径 `../dsh-market`；内置的可视化插件市场，npm 包名 `dshmarket`）
- **TypeScript**

## 开发

### 集成方式

- **源码引用**：dsh 与本工程同级目录（`../deepseek-harness`，非 submodule），消费其编译产物。插件市场 dsh-market 同样位于同级目录（`../dsh-market`，npm 包名 `dshmarket`），其编译产物被物化为 dsh 的 `node_modules/dshmarket` 并作为内置插件打包；两者都是编译必需的同级依赖。
- **Host 集成**：`src/main/host.ts` 动态 import dsh 的 `runProfile`（apps/cli 编译产物），
  主进程内挂起 dsh Host（webserver 绑定 `127.0.0.1:<空闲端口>`），返回
  `{ ctx, shutdown, port, url }` 句柄。
- **同源数据面**：渲染进程 `loadURL(http://127.0.0.1:<port>/)` 同源加载 dsh Web UI，复用
  `WebApiClient`（HTTP 上行 + WebSocket 下行），零 CORS、零鉴权、零新载体。
- **desktop profile**：`profiles/desktop/`（`dsh.profile.bundles = [dsh-base, dsh-web-app]`，
  cordis.patch.yml 覆盖 `web-runtime.printUrl: false`），运行时复制到
  `$DSH_HOME/profiles/desktop`。

### 编译过程（含 patches）

dsh 依赖 Node 内部 API（HMR、原生目录对话框），Electron 下不可用，需打三个补丁后构建。
一条命令完成（幂等，`--reverse --check` 检测已应用则跳过）。它同时会构建同级的 `../dsh-market` 插件市场：

```bash
npm run build:dsh   # ① git apply patches/ 三个补丁 → ② pnpm install（node_modules 缺失时）→ ③ build:lib:host + build:lib:client + build:web → ④ 构建 ../dsh-market（缺 node_modules 时 npm install + npm run build）
```

**前置条件——同级源码 checkout。** 本工程以同级目录（非 submodule）方式消费 `deepseek-harness` 与 `dsh-market`，构建前需把二者 clone 到本工程的同级目录：

```bash
# dsh：锁定 tag = dsh-v0.2.0-rc.2（同时见 .github/workflows，与 patches/dsh-v0.2.0-rc.2/ 对应）
git clone --branch dsh-v0.2.0-rc.2 https://github.com/deepseek-ai/deepseek-harness.git ../deepseek-harness
git clone --branch v1.26.0    https://github.com/dsh-market/dsh-market.git         ../dsh-market
```

若缺少 `../dsh-market`，`collect-dsh.mjs` 会硬失败（打包产物需要把它物化为 `dsh-dist/node_modules/dshmarket`）；`build:dsh` 在缺少时仅告警并跳过市场构建。

> **dsh 版本锚定**：本工程基于 deepseek-harness tag **`dsh-v0.2.0-rc.2`** 构建。补丁按 dsh 版本分目录存放（`patches/<dsh-tag>/`），`scripts/build-dsh.mjs` 固定指向 `patches/dsh-v0.2.0-rc.2/` —— 升级到新的 dsh tag 时，需新增对应的 `patches/<新 tag>/` 目录并更新该指向。

| 补丁 | 作用 |
|---|---|
| `patches/dsh-v0.2.0-rc.2/dsh-disable-hmr.patch` | 给 `runProfile` 加 `DSH_DISABLE_HMR` 开关，跳过 watch-only HMR（HMR 依赖 `--expose-internals`）|
| `patches/dsh-v0.2.0-rc.2/dsh-disable-native-picker.patch` | 让 directory-picker 在 Electron 下强制用 browse（原生对话框 worker 用 electron.exe 启动失败）|
| `patches/dsh-v0.2.0-rc.2/dsh-disable-welcome-notice.patch` | 移除客户端两步 `settings.onboarding`（版本化内测声明 + 官方 DeepSeek API Key 引导），首启直接进入应用；同步更新 `apply.client.spec.ts` 以匹配实际注册集 |

> Electron 兼容根因：dsh 的 loader 经 `node-addon-require-builtin` 原生模块获取 Node 内部
> ESM loader，该模块依赖 Electron V8 缺失的 `GetAlignedPointerFromEmbedderData` 符号而失效；
> 开发模式下 loader 回退默认 ESM import，由 `host.ts` 的 `ensureWorkspaceLinks` 把 workspace
> 包链接到 dsh 根 node_modules 解决。

### 常用命令

```bash
# 本工程依赖（npm 包，含 Electron / Forge / Vite）
npm install

# dsh 依赖（在 ../deepseek-harness 下执行；pnpm 工程）
cd ../deepseek-harness && pnpm i

# 开发模式：Vite 构建 + 启动 Electron，主进程挂起 dsh Host 并加载其 Web UI
npm start

# 打包（prepackage 自动 collect：pnpm deploy 物化 dsh 产物到 dsh-dist/，extraResource 打进 resources/）
npm run package

# 出分发制品：Windows Squirrel 安装器 / 免安装 ZIP（见 forge.config.ts 的 makers）
npm run make
```

> 打包产物 `out/DSH Desktop-win32-x64/` 已含 dsh（lib + node_modules + web dist + profile），exe 可直接运行 dsh。

### Windows 本地构建排障

Windows + 受限网络（GitHub 不可达 / Corepack 受限）下，`npm run package` 可能踩到以下三个坑。均已验证的解法：

**1. pnpm 版本不一致（`pnpm --filter` 解析到旧版本）**

`deepseek-harness` 的 `package.json` 锁定 `packageManager: pnpm@11.7.0`，但 `corepack pnpm --filter <pkg> run ...` 在子工作区会解析到另一个版本（如 11.5.2）并报 `This project is configured to use 11.7.0 of pnpm`。`corepack enable` 在 nvm 管理的 Node 下会因目录无写权限报 `EPERM`，无法生成 pnpm shim；`.npmrc` 的 `pm-on-fail=ignore` 也无效（版本检查发生在读配置之前）。

解法——手工建一个调用 corepack 的 `pnpm.cmd` shim，放到用户可写目录并置于 PATH 前部：

```powershell
$shimDir = "C:\Users\$env:USERNAME\AppData\Local\pnpm-shim"
New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
$corepackCmd = (Get-Command corepack.cmd).Source   # 形如 C:\Program Files\nodejs\corepack.cmd
Set-Content -Path (Join-Path $shimDir "pnpm.cmd") -Value @"
@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
call "$corepackCmd" pnpm %*
"@ -Encoding ASCII
$env:PATH = "$shimDir;$env:PATH"    # 之后每次构建前都要带上
```

**2. `fetch-runtime` 重复下载（缺 `.versions.json` 版本戳）**

`scripts/fetch-runtime.mjs` 幂等依赖 `runtime/.versions.json`。若首次下载被中断（如 shell 超时），`runtime/node/` 与 `runtime/pnpm/` 可能已就位但版本戳未写，导致下次 `npm run package` 又重新下载 Node + pnpm。

解法——确认 `runtime/node/node.exe` 与 `runtime/pnpm/pnpm.exe` 存在后，手写版本戳使其跳过下载：

```powershell
# 内容必须与脚本内拼的 wanted 串完全一致（node / pnpm / platform / arch）
'{"node":"24.11.1","pnpm":"9.15.9","platform":"win32","arch":"x64"}' |
  Set-Content -Path .\runtime\.versions.json -Encoding ASCII -NoNewline
```

**3. Electron 二进制下载 `ETIMEDOUT`（GitHub 被墙）**

`electron-forge package` 阶段会从 `github.com` 下载对应版本的 Electron 二进制，网络受限时报 `connect ETIMEDOUT`。

解法——改用 npmmirror 国内镜像（环境变量在当次构建进程内生效）：

```powershell
$env:ELECTRON_MIRROR = "https://registry.npmmirror.com/-/binary/electron/"
$env:ELECTRON_CUSTOM_DIR = "v{{ version }}"
npm run package
```

> 三者叠加（pnpm shim 入 PATH + 版本戳就绪 + Electron 镜像）即可在受限 Windows 环境稳定跑通 `npm run package` / `npm run make`。

## 目录结构

本工程与 deepseek-harness（dsh）、dsh-market **同级目录**（非 submodule），经源码引用集成：

```
（同级目录）
├── dsh-desktop/      # 本工程（Electron 桌面壳）
│   ├── docs/                      # 产品概念设计
│   ├── specs/                     # 规范文档（as-built，索引见 specs/README.md）
│   ├── patches/                   # dsh 上游补丁（git apply，build:dsh 自动应用）
│   │   ├── dsh-disable-hmr.patch
│   │   ├── dsh-disable-native-picker.patch
│   │   └── dsh-disable-welcome-notice.patch
│   ├── scripts/                   # 构建脚本
│   │   ├── build-dsh.mjs          # apply patches + 安装依赖 + 构建 dsh + dsh-market 产物
│   │   ├── collect-dsh.mjs        # 收集 dsh 产物到 dsh-dist/（pnpm deploy + 物化 dshmarket）
│   │   └── fetch-runtime.mjs      # 拉取便携 Node + pnpm 到 runtime/（打包态安装通道）
│   ├── profiles/desktop/          # 自定义 desktop profile（dsh.profile.bundles + cordis.patch.yml）
│   ├── src/
│   │   ├── main/                  # Electron 主进程（= dsh Host 宿主）
│   │   │   ├── index.ts           # 单实例锁 → 启动 host → 建窗 → 托盘/通知/生命周期
│   │   │   ├── host.ts            # runProfile('desktop') → { ctx, shutdown }；插件链接/解析
│   │   │   ├── runtime.ts         # 便携 Node/pnpm/dsh shim + PATH 注入（市场安装通道）
│   │   │   ├── windows.ts         # BrowserWindow、loadURL(localhost)、原生 frame/安全
│   │   │   ├── window-state.ts     # 窗口状态持久化（最大化/位置尺寸）+ F11 全屏
│   │   │   ├── tray.ts            # 系统托盘（退出/唤回）
│   │   │   ├── notifications.ts   # 订阅 ctx session/event → 原生通知
│   │   │   └── lifecycle.ts       # NO_PROXY/CA、崩溃兜底
│   │   ├── preload/index.ts       # preload 入口（无窗口控制桥）
│   │   └── renderer/renderer.ts   # 极薄渲染入口（兜底加载页）
│   ├── forge.config.ts            # Electron Forge 配置（extraResource 打进 dsh-dist + runtime）
│   ├── vite.*.config.ts           # Vite 配置（main/preload/renderer）
│   ├── index.html                 # 渲染入口（Forge Vite 约定在项目根）
│   └── resources/                 # 应用图标、托盘图标
│
├── deepseek-harness/              # 被封装宿主（dsh，源码引用，非 submodule）
│   ├── apps/                      # cli（dsh bin，profile-boot）、web（Web 前端，build:web 产出 dist）
│   ├── packages/                  # host / client / core / session 等 workspace 包
│   ├── vendor/                    # vendored cordis 框架包（cordis / loader / hmr 等）
│   └── native/                    # landlock-run 原生模块（Linux 沙箱，MVP 已裁掉）
│
└── dsh-market/                    # 插件市场（源码引用，非 submodule；npm 包名 "dshmarket"）
    ├── src/                       # host 端（挂载 /dsh-market/* 路由，spawn `dsh plugin`）
    ├── client/                    # 浏览器端（设置页 UI；构建到 client/client.js）
    ├── lib/                       # host 端编译产物（物化为 dsh-dist/node_modules/dshmarket）
    └── cordis.patch.yml           # loader insert 声明（{ id: dsh-market, name: dshmarket }）
```

> **CI 说明**：GitHub Actions 在工作流中 clone 两个同级仓库（见
> `.github/workflows/ci.yml` 与 `release.yml` 的 `Checkout dsh (sibling)`、
> `Checkout dsh-market (sibling)` 步骤），因为 `actions/checkout` 无法把第二个仓库放进
> `$GITHUB_WORKSPACE` 内。

## 相关文档

- [docs/000-产品概念设计.md](docs/000-产品概念设计.md) —— 产品概念设计（架构方案、数据流、模块划分、开放问题）
- [specs/README.md](specs/README.md) —— 规范文档索引（项目级 + 模块级规格文档）
- [AGENTS.md](AGENTS.md) —— AI Agent 工作规范

## 参考

- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（同级目录 `../deepseek-harness`）—— 被封装的宿主，其 `docs/` 目录含完整架构文档
- [dsh-market](https://github.com/dsh-market/dsh-market)（同级目录 `../dsh-market`）—— 内置的可视化插件市场（npm 包 `dshmarket`），经 `collect-dsh.mjs` 打包
- [opencode](https://github.com/sst/opencode)（桌面壳参考：`packages/desktop/`）—— 类似的「用 Electron 包装 agent harness」需求

## 许可证

[MIT](LICENSE) © 2026 fellow99
