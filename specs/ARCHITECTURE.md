> ⚠️ **变更（011-version-0.1.5，2026-09-13）**：窗口已改为**常规 Windows 标题栏（`frame:true`）**；已移除自定义窗口控制 IPC（`registerWindowIpcHandlers` / `window:*`）与 preload 的 `window.dsh`，并新增**主窗口状态持久化**与 **F11 全屏**。本文档为改造前的 as-built 记录；与当前代码不一致处，以 `src/main/windows.ts`、`src/main/window-state.ts`、`src/preload/index.ts` 及 `specs/011-version-0.1.5/spec.md` 为准。

# ARCHITECTURE.md — 整体架构

> dsh-desktop 整体架构（2026-08-14）。核心设计见 `docs/000-产品概念设计.md`。

## 1. 架构一句话

基于 Electron 的 deepseek-harness（dsh）桌面封装——**主进程内 runProfile('desktop') 挂起 dsh Host（含 webserver），渲染进程同源加载 localhost**，界面 100% 复用 dsh Web UI，桌面壳只补托盘、通知、无边框窗口、剪贴板等能力。

## 2. 进程模型

```
┌─ Electron 主进程（Node.js，也承载 dsh Host）─────────────────┐
│  runProfile('desktop', args:['--port','0']) → { ctx, shutdown }│
│    ├─ webserver      ← 绑定 127.0.0.1:<空闲端口>，服务 dist + /api│
│    ├─ apiProxy       ← RPC 网关（createApiProxy）             │
│    └─ connection node half ← 已把 /api + WebSocket 注册到 webserver│
│  就绪后：BrowserWindow.loadURL(`http://127.0.0.1:${port}/`)    │
│  ┌─ Tray / Notification：订阅 ctx 的 session/event            │
│  └─ 无边框窗口控制：ipcMain.handle(min/max/close)             │
└──────────────▲───────────────────────────────────────────────┘
               │ contextBridge：window.dsh（仅窗口控制等薄 IPC） │
┌──────────────┴───────────────────────────────────────────────┐
│ 渲染进程：loadURL('http://127.0.0.1:<port>/')  ← 同源          │
│   标准 dsh Web UI（WebApiClient：fetch /api + WS /api/events.mux）│
└──────────────────────────────────────────────────────────────┘
```

## 3. 分层

| 层 | 组件 | 职责 |
|---|---|---|
| 桌面壳（主进程） | `src/main/index.ts` | 单实例锁、启动编排、生命周期 |
| | `src/main/host.ts` | runProfile → Host 句柄（ctx/shutdown/port/url） |
| | `src/main/windows.ts` | BrowserWindow 创建、loadURL、无边框、安全加固 |
| | `src/main/tray.ts` / `notifications.ts` | 系统托盘（退出/唤回）、原生通知 |
| | `src/main/lifecycle.ts` | NO_PROXY/CA、崩溃兜底 |
| 薄 IPC（preload） | `src/preload/index.ts` | contextBridge 暴露 `window.dsh`（窗口控制） |
| 渲染进程 | `index.html`（兜底页） | host 就绪前/失败时的占位；实际内容由 dsh 提供 |
| 宿主（dsh） | webserver / apiProxy / connection | SPA dist + `/api` + WebSocket 事件流 |
| 配置 | `profiles/desktop/` | desktop profile（bundles + cordis.patch.yml） |

## 4. 数据流

- **上行（unary）**：渲染进程 `WebApiClient.doFetch` → `fetch('/api/<method>')`（同源，无 CORS）→ webserver 的 `/api` 路由（connection node half 注册）→ `toFetchHandler(apiProxy).fetch`。
- **下行（事件帧）**：渲染进程 `WebApiClient.openMux/openHost` → `WebSocket('/api/events.mux')` / `('/api/events.host')`（同源）→ 帧流。
- **桌面侧通知/托盘**：主进程**直接订阅 `ctx` 的 `session/event`**（进程内，无需经 HTTP/WS），触发 Electron `Notification` / `Tray`。

## 5. 关键架构决策

| # | 决策 | 理由 |
|---|---|---|
| 1 | 同源 loadURL(localhost)，零 CORS/零鉴权/零自定义协议/零 IPC 载体 | dsh webserver 同源服务 dist + `/api`；复用 `WebApiClient` 零上游改动 |
| 2 | 进程内 Host（MVP） | 直连 ctx 订阅事件最省事；渲染进程只认 localhost，迁移 utilityProcess 透明 |
| 3 | 双门就绪（主进程 await startHost 后建窗） | 参考 opencode：host 就绪前不建窗，避免加载竞争 |
| 4 | 薄 IPC（数据面不过 IPC） | 数据走 HTTP/WS；IPC 仅窗口控制（min/max/close） |
| 5 | 安全基线（sandbox+contextIsolation+无 nodeIntegration+导航加固+权限白名单） | 参考 opencode，渲染进程加载不可信 localhost 内容 |
| 6 | MVP 裁掉 dsh native 沙箱（landlock） | 规避 Electron Node ABI 不一致；后续 electron-rebuild 恢复 |

## 6. 与参考实现（opencode desktop）的差异

| | 本项目 | opencode |
|---|---|---|
| UI 加载 | `loadURL(localhost)` 同源 | `oc://` 自定义协议 |
| 鉴权/CORS | 无 | Basic auth + CORS 注入 |
| 后端进程 | 主进程内（MVP） | `utilityProcess` |
| 数据面 | HTTP + WebSocket（同源） | HTTP + WebSocket |
| 构建 | Electron Forge | electron-vite + electron-builder |

## 7. 部署拓扑

- **分发**：本地打包自用（Electron Forge `make`），暂不做自动更新、代码签名、商店分发。
- **产物**：Windows（Squirrel 安装器 + zip 目录包）、Linux（deb + rpm）。
- **宿主依赖**：dsh 构建产物（lib host/client + web dist）随包打入 resources。
