> ⚠️ **变更（011-version-0.1.5，2026-09-13）**：窗口已改为**常规 Windows 标题栏（`frame:true`）**；已移除自定义窗口控制 IPC（`registerWindowIpcHandlers` / `window:*`）与 preload 的 `window.dsh`，并新增**主窗口状态持久化**与 **F11 全屏**。本文档为改造前的 as-built 记录；与当前代码不一致处，以 `src/main/windows.ts`、`src/main/window-state.ts`、`src/preload/index.ts` 及 `specs/011-version-0.1.5/spec.md` 为准。

# 118-preload-bridge 技术方案（As-Built）

> 本文档为「回溯性」技术方案，记录模块实际架构、设计决策与实现策略。
> 模块：118-preload-bridge
> 对应规格：specs/118-preload-bridge/spec.md
> 最后更新：2026-08-14

## 1. 技术上下文

### 1.1 运行时环境

- **运行位置**：Electron preload 上下文（在渲染进程的隔离世界中运行，`contextIsolation:true` 下经 `contextBridge` 桥接到主世界）。
- **构建产物**：`src/preload/index.ts` → `.vite/build/preload.js`（Forge Vite 插件 `build[]` 入口之一）。
- **挂载点**：`src/main/windows.ts` 的 `webPreferences.preload = path.join(__dirname, 'preload.js')`，并配置 `sandbox:true` + `contextIsolation:true` + `nodeIntegration:false`。

### 1.2 依赖

| 依赖 | 类型 | 用途 |
|---|---|---|
| `electron`（`contextBridge` / `ipcRenderer`） | 内置 | `exposeInMainWorld` 暴露 API；`invoke` 异步调用主进程 |

> 无第三方 npm 依赖。

## 2. 宪法合规检查

| 宪法原则（constitution.md） | 状态 | 说明 |
|---|---|---|
| §3 IPC 宪法 1「数据面不过 IPC」 | ✅ | 仅暴露窗口控制，业务数据走同源 HTTP + WebSocket |
| §3 IPC 宪法 2「IPC 仅壳层关注点」 | ✅ | `window.dsh` 仅 min/max/close/isMaximized |
| §3 IPC 宪法 3「preload 最小暴露」 | ✅ | 不暴露 Node 能力，仅 4 个无参方法 |
| §2 安全宪法 1「安全基线」 | ✅ | 运行于 sandbox + contextIsolation + 无 nodeIntegration 窗口 |
| §1 架构宪法 1「零上游改动」 | ✅ | 不新写 IPC 数据载体，IPC 面最小化 |
| §4 代码质量 1「严格类型」 | ✅ | 导出 `DshApi` 类型，无 `as any`/`@ts-ignore` |

## 3. 研究结论

- **`contextBridge.exposeInMainWorld` 模式**：在 contextIsolation 下把受限 API 桥接到渲染进程主世界，是 Electron 官方安全暴露标准。
- **`ipcRenderer.invoke` + `ipcMain.handle` 配对**：异步请求-响应，返回 Promise，与主进程 `registerWindowIpcHandlers`（windows.ts）一一对应。
- **为什么数据面不过 IPC**：dsh 的 `WebApiClient` 已实现同源 `fetch('/api')` 上行 + `WebSocket('/api/events.*')` 下行，复用即可；走 IPC 需新写载体插件，违背「零上游改动」。
- **观察到的命名/行为细节**：`window.dsh.maximize()` 对应主进程 handler 的「切换」语义（`isMaximized ? unmaximize : maximize`），即方法名为 `maximize` 但实际是 toggle；查询实际状态用 `isMaximized()`。此为源码实际行为（对应 FR-118-003）。
- **`close` 的连带行为**：`window.dsh.close()` 触发窗口 `close` 事件，关窗即退出（由入口模块的 `window-all-closed` 触发应用退出，行为归属窗口/入口模块，preload 仅触发）。

## 4. 数据模型

### 4.1 DshApi 类型

```ts
export type DshApi = typeof api; // { minimize; maximize; close; isMaximized }
```

| 方法 | 返回类型 | 说明 |
|---|---|---|
| `minimize` | `Promise<void>` | 最小化窗口 |
| `maximize` | `Promise<void>` | 切换最大化 / 还原 |
| `close` | `Promise<void>` | 触发窗口关闭（关窗即退出） |
| `isMaximized` | `Promise<boolean>` | 查询最大化状态 |

### 4.2 IPC 通道映射

| 渲染进程调用 | IPC 通道 | 主进程 handler（windows.ts） |
|---|---|---|
| `minimize()` | `window:minimize` | `minimize()` |
| `maximize()` | `window:maximize` | `isMaximized ? unmaximize : maximize` |
| `close()` | `window:close` | `close()` |
| `isMaximized()` | `window:is-maximized` | `isMaximized() ?? false` |

## 5. 接口契约

### 5.1 提供的接口

- `window.dsh`（经 `contextBridge.exposeInMainWorld('dsh', api)` 暴露）：上述 4 个方法。

### 5.2 消费的接口

- `electron.ipcRenderer.invoke(channel, ...args)`：4 个窗口控制通道。
- 主进程 `ipcMain.handle` 注册的对应 handler（`src/main/windows.ts`）。

### 5.3 事件协议

- 无自定义事件协议；仅使用 `invoke`/`handle` 的请求-响应模式。

## 6. 实现策略

### 6.1 架构模式

- 单文件 preload，定义 `api` 对象字面量 → `contextBridge.exposeInMainWorld('dsh', api)` → 导出 `DshApi` 类型供（可选）渲染进程消费。
- 每个方法为无参箭头函数，直接 `return ipcRenderer.invoke(...)`（自动返回 Promise）。

### 6.2 关键算法

- 无复杂算法；纯委托：preload 方法 → `ipcRenderer.invoke` → 主进程 handler。

### 6.3 错误处理

- 主进程 handler 对「找不到窗口」做防御（`?.` 可选调用 / 显式 `if (!win) return` / `?? false` 兜底），preload 侧无额外错误处理。

### 6.4 性能

- 每次调用一次 `invoke`（进程间异步消息），无热路径、无轮询；开销可忽略。

## 7. 测试考量

- **集成**：窗口控制往返——调用 `window.dsh.minimize/maximize/isMaximized/close`，断言主进程窗口状态变化正确（含 toggle 语义与 `isMaximized` 返回值）。
- **类型一致性**：`DshApi` 与主进程 `registerWindowIpcHandlers` 的通道名保持一致（防止通道字符串漂移）。
- **边界**：`isMaximized` 在窗口不存在时返回 `false`；`maximize` 连续两次调用还原状态。

## 8. 文件清单

| 文件 | 用途 | 行数 |
|---|---|---|
| `src/preload/index.ts` | contextBridge 暴露 `window.dsh`（薄 IPC） | 21 |

## 9. 与规格的交叉引用

| 技术决策 | 对应规格需求 |
|---|---|
| `contextBridge.exposeInMainWorld('dsh', api)` 暴露 4 方法 | FR-118-001 |
| `ipcRenderer.invoke` 返回 Promise | FR-118-002 |
| `window:maximize` handler 的 toggle 语义 | FR-118-003 |
| 仅窗口控制、无数据通道 | FR-118-004、FR-118-005 |
| preload 对窗口所有页面生效（含 localhost 宿主 UI） | FR-118-006 |
