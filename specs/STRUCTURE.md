> ⚠️ **变更（011-version-0.1.5，2026-09-13）**：窗口已改为**常规 Windows 标题栏（`frame:true`）**；已移除自定义窗口控制 IPC（`registerWindowIpcHandlers` / `window:*`）与 preload 的 `window.dsh`，并新增**主窗口状态持久化**与 **F11 全屏**。本文档为改造前的 as-built 记录；与当前代码不一致处，以 `src/main/windows.ts`、`src/main/window-state.ts`、`src/preload/index.ts` 及 `specs/011-version-0.1.5/spec.md` 为准。

# STRUCTURE.md — 目录文件结构

> dsh-desktop 目录结构记录（脚手架搭建后，2026-08-14）。

## 1. 顶层目录树

```
dsh-desktop/
├── .gitignore                # git 忽略（node_modules、.vite、out 等）
├── AGENTS.md                 # AI Agent 工作规范（项目级）
├── LICENSE                   # MIT
├── README.md                 # 项目说明（架构概览）
├── package.json              # Electron Forge 工程清单（main 指向 .vite/build/main.js）
├── package-lock.json         # npm 依赖锁
├── forge.config.ts           # Electron Forge 配置（makers + VitePlugin + FusesPlugin）
├── forge.env.d.ts            # Forge Vite 全局类型引用（MAIN_WINDOW_VITE_* 等）
├── tsconfig.json             # TypeScript 配置（commonjs、strict）
├── vite.main.config.ts       # 主进程 Vite 配置（预留 dsh external）
├── vite.preload.config.ts    # preload Vite 配置
├── vite.renderer.config.ts   # 渲染进程 Vite 配置（极薄）
├── index.html                # 渲染入口（兜底加载页，Forge Vite 约定在项目根）
│
├── docs/                     # 产品/需求文档
│   └── 000-产品概念设计.md    # 产品概念设计（架构方案、数据流、模块划分）
│
├── specs/                    # 规范文档（本目录，见 specs/README.md 索引）
│
├── patches/                  # dsh 上游补丁（git apply 机制）
│   └── dsh-disable-hmr.patch # Electron 兼容：DSH_DISABLE_HMR 开关（dsh HMR 依赖 Node 内部 API）
│
├── scripts/                  # 构建脚本
│   └── build-dsh.mjs         # apply patches/ 补丁 + pnpm install + 构建 dsh lib host/client + web dist
│
├── profiles/                 # dsh 自定义 profile
│   └── desktop/
│       ├── package.json      # dsh.profile.bundles = [dsh-base, dsh-web-app]
│       └── cordis.patch.yml  # 覆盖 web-runtime.printUrl: false
│
├── resources/                # 应用/托盘图标（占位）
│   └── README.md
│
└── src/
    ├── main/                 # Electron 主进程（= dsh Host 宿主）
    │   ├── index.ts          # 单实例锁 → 启动 host → 建窗 → 托盘/通知/生命周期编排
    │   ├── host.ts           # runProfile('desktop') → { ctx, shutdown }；就绪判定（已消费 dsh）
    │   ├── windows.ts        # BrowserWindow 创建、loadURL(localhost)、无边框/安全
    │   ├── tray.ts           # 系统托盘（退出/唤回）
    │   ├── notifications.ts  # 订阅 ctx session/event → 原生通知
    │   └── lifecycle.ts      # NO_PROXY/CA、崩溃兜底
    ├── preload/
    │   └── index.ts          # contextBridge：window.dsh（窗口控制薄 IPC）
    └── renderer/
        └── renderer.ts       # 极薄渲染入口（兜底加载页）
```

## 2. 进程入口

| 进程 | 入口 | 构建产物 | 说明 |
|---|---|---|---|
| 主进程 | `src/main/index.ts` | `.vite/build/main.js` | 也承载 dsh Host（MVP 进程内） |
| preload | `src/preload/index.ts` | `.vite/build/preload.js` | contextBridge 暴露 `window.dsh` |
| 渲染进程 | `index.html` → `src/renderer/renderer.ts` | `.vite/renderer/main_window/` | 极薄兜底页；生产环境主进程直接 `loadURL(localhost)` 加载 dsh Web UI |

## 3. 关键配置文件

| 文件 | 作用 |
|---|---|
| `package.json` | `main` 指向 `.vite/build/main.js`（Forge Vite 约定）；scripts：start/package/make/publish/typecheck |
| `forge.config.ts` | makers：squirrel(win) + zip + deb + rpm(linux)；VitePlugin（build: main+preload，renderer: main_window）；FusesPlugin |
| `tsconfig.json` | commonjs、strict、include `src` + `forge.env.d.ts` |
| `vite.main.config.ts` | 预留 dsh 依赖 external（TODO 消费 dsh 时启用） |
| `profiles/desktop/cordis.patch.yml` | desktop profile 用户 patch（覆盖 printUrl） |

## 4. 目录结构记录说明

- 本文件由脚手架搭建后扫描工程生成，供后续开发参考。
- `node_modules/`、`.vite/`、`out/` 为构建/依赖产物，已 gitignore，不列入。
- 模块级规范文档见 `specs/<编号>-<模块>/`，模块编号划分见 `specs/README.md`。
