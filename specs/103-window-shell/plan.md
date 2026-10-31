> ⚠️ **变更（011-version-0.1.5，2026-09-13）**：窗口已改为**常规 Windows 标题栏（`frame:true`）**；已移除自定义窗口控制 IPC（`registerWindowIpcHandlers` / `window:*`）与 preload 的 `window.dsh`，并新增**主窗口状态持久化**与 **F11 全屏**。本文档为改造前的 as-built 记录；与当前代码不一致处，以 `src/main/windows.ts`、`src/main/window-state.ts`、`src/preload/index.ts` 及 `specs/011-version-0.1.5/spec.md` 为准。

# 103-window-shell 技术方案（As-Built）

> 本文档为回溯式技术方案，记录窗口管理模块的**实际**架构、设计决策与实现策略。
> Module: 103-window-shell
> 对应规格: [spec.md](./spec.md)
> Last Updated: 2026-08-14

## 1. 技术上下文

### 1.1 运行时环境

- 运行于 **Electron 主进程**（Node.js 环境，Electron `^43.4.0`）。
- 直接依赖 `electron` 的 `BrowserWindow`、`ipcMain`、`nativeTheme`、`shell`，以及 Node 内置 `node:path`。
- 编译产物：`src/main/windows.ts` → `.vite/build/main.js`；预加载脚本编译为 `.vite/build/preload.js`（窗口通过 `path.join(__dirname, 'preload.js')` 引用）。

### 1.2 依赖

| 依赖 | 用途 |
|------|------|
| `electron`（BrowserWindow / ipcMain / nativeTheme / shell） | 窗口创建、IPC、明暗主题判定、外部浏览器打开 |
| `node:path` | 拼接预加载脚本与兜底页路径 |
| 全局常量 `MAIN_WINDOW_VITE_DEV_SERVER_URL` / `MAIN_WINDOW_VITE_NAME` | Forge Vite 注入的开发服务器地址 / 渲染产物目录名 |

## 2. 宪法合规检查

| 原则 | 状态 | 说明 |
|------|------|------|
| 安全：安全基线（sandbox + contextIsolation + 无 nodeIntegration） | ✅ | `webPreferences` 三项齐全（实现 FR-103-005） |
| 安全：导航加固 | ✅ | `setWindowOpenHandler` 一律 deny + `will-navigate` 白名单（FR-103-007/008） |
| 安全：权限白名单 | ✅ | `clipboard-sanitized-write` + `notifications`，且受信来源 + 对应 webContents 三条件（FR-103-009） |
| IPC：薄 IPC / 数据面不过 IPC | ✅ | 仅 `window:minimize/maximize/close/is-maximized`（FR-103-010） |
| IPC：preload 最小暴露 | ✅ | preload 仅暴露上述 4 个方法（`window.dsh`），无 Node 能力 |
| 生命周期：关窗退出 | ✅ | close 事件放行，由入口模块触发退出（FR-103-011） |
| 代码质量：TypeScript strict / 无 as any | ✅ | 无 `as any`；仅用 `as const`（字面量类型断言，合法） |
| 代码质量：严禁空 catch | ✅ | `isTrustedOrigin` 的 `catch` 返回 false（显式降级），无空 catch |

> 合规结论：全部 ✅，无 ⚠️ / ❌。

## 3. 研究结论

### 3.1 关键决策与理由

| 决策 | 理由 |
|------|------|
| 无边框 + `titleBarOverlay`（仅 win32） | 参考 opencode desktop（`packages/desktop/src/main/windows.ts`）；win32 用 `titleBarOverlay`，非 win32 退化为 `titleBarStyle: 'hidden'` |
| `titleBarOverlay.color = '#00000000'`（透明） | 让渲染层自绘标题栏背景，与 dsh Web UI 视觉一体 |
| `symbolColor` 随 `nativeTheme.shouldUseDarkColors` 切换 | 标题栏按钮颜色自适应明暗主题 |
| `show: false` + `ready-to-show` 再显示 | 避免白屏闪烁（FR-103-013） |
| `setWindowOpenHandler` 一律 `deny` + 外部走 shell | 任何 `window.open` 都不在应用内开新窗口，外部地址交系统浏览器 |
| `will-navigate` 仅放行受信来源 | 阻止渲染层被劫持导航到恶意地址 |
| 权限三条件（白名单权限 + 受信来源 + 对应 webContents） | 防止其它 webContents / 非受信来源滥用权限 |
| 关窗放行（不拦截 close） | 关窗即退出；由入口模块的 `window-all-closed` 触发应用退出（FR-103-011） |

### 3.2 受信来源判定（`isTrustedOrigin`）

- 回环 http：`protocol === 'http:'` 且 `hostname ∈ { '127.0.0.1', 'localhost' }`。
- 开发服务器：`MAIN_WINDOW_VITE_DEV_SERVER_URL` 非空且 `rawUrl.startsWith(该前缀)`。
- 解析失败（`try/catch`）一律视为不受信。

### 3.3 三级加载降级（`createMainWindow(url)`）

```
url 非空            → loadURL(url)          // 宿主 localhost（FR-103-003）
否则 dev server 存在 → loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)  // 开发态
否则               → loadFile(../renderer/<MAIN_WINDOW_VITE_NAME>/index.html)  // 兜底页（FR-103-004）
```

## 4. 数据模型

### 4.1 实体与状态

- `RENDERER_PERMISSIONS = new Set(['clipboard-sanitized-write', 'notifications'])`：模块级常量（FR-103-009）。

### 4.2 状态机（窗口生命周期）

```
created（show:false）
  → loadURL(localhost) / loadURL(dev) / loadFile(兜底页)
  → ready-to-show → shown
                        ↓
  close → closed → window-all-closed → 应用退出（关窗即退出）
```

### 4.3 校验规则

- 权限申请三条件：`RENDERER_PERMISSIONS.has(permission)` AND `isTrustedOrigin(details.requestingUrl)` AND `wc.id === webContentsId`。
- 导航：`setWindowOpenHandler` 无条件 deny；`will-navigate` 非受信来源 `preventDefault` + `shell.openExternal`。

## 5. 接口契约

### 5.1 提供接口（本模块导出）

| 导出 | 签名 | 说明 |
|------|------|------|
| `registerWindowIpcHandlers()` | `void` | 注册窗口控制 IPC（min/max/close/is-maximized） |
| `createMainWindow(url: string \| null)` | `BrowserWindow` | 创建并加载主窗口，返回实例 |

### 5.2 消费接口（本模块 import）

| 来源 | 符号 |
|------|------|
| `electron` | `BrowserWindow`, `ipcMain`, `nativeTheme`, `shell` |
| `node:path` | `path` |
| Forge 全局常量 | `MAIN_WINDOW_VITE_DEV_SERVER_URL`, `MAIN_WINDOW_VITE_NAME` |

### 5.3 事件协议（IPC）

| 通道 | 方向 | 载荷 | 返回 |
|------|------|------|------|
| `window:minimize` | 渲染 → 主（invoke） | — | void |
| `window:maximize` | 渲染 → 主（invoke） | — | void（切换最大化/还原） |
| `window:close` | 渲染 → 主（invoke） | — | void（触发 close 事件，关窗即退出） |
| `window:is-maximized` | 渲染 → 主（invoke） | — | boolean |

> 渲染层经 preload `contextBridge.exposeInMainWorld('dsh', api)` 调用（`window.dsh.minimize()` 等）。

### 5.4 事件（webContents）

| 事件 | 用途 |
|------|------|
| `setWindowOpenHandler` | 新窗口请求一律 deny + 外部走 shell |
| `will-navigate` | 导航加固 |
| `close` | 放行关闭（关窗即退出） |
| `did-fail-load` | 记录加载失败（`console.error`） |
| `ready-to-show` | 就绪后再显示 |

## 6. 实现策略

### 6.1 架构模式

**工厂函数**：`createMainWindow` 为窗口工厂；IPC 注册为独立函数（由 `index.ts` 在 `whenReady` 后调用一次）。

### 6.2 关键算法

- `isTrustedOrigin(rawUrl)`：URL 解析 → 回环 http 判定 / dev server 前缀判定 → 布尔（异常返回 false）。
- `window:maximize`：`isMaximized()` 为真则 `unmaximize()`，否则 `maximize()`。
- 窗口控制统一用 `BrowserWindow.fromWebContents(event.sender)` 反查窗口实例，避免闭包持有过期引用。

### 6.3 错误处理

- `did-fail-load`：`console.error('[dsh-desktop] failed to load <url>: <code> <desc>')`（FR-103-014；脚手架阶段以 console 占位，整体日志框架待接入）。
- `isTrustedOrigin` 解析异常：返回 false（显式降级，非空 catch）。
- 权限申请：默认拒绝（`callback(false)`），仅三条件全满足才放行。

### 6.4 性能

- `show: false` + `ready-to-show` 延迟显示，避免白屏；
- 无额外轮询/缓存；窗口控制 IPC 为一次性注册。

## 7. 测试考虑

- **类型检查**：`npm run typecheck`（基本质量门）。
- **单元**：`isTrustedOrigin` 对回环 / 非回环 / 异常 URL 的判定。
- **集成/e2e**：窗口加载 localhost / 兜底页；关窗即退出；外部链接走系统浏览器。
- **边界**：`maximize` 的往返切换；`will-navigate` 对受信来源的放行；权限申请中 `wc.id` 不匹配时拒绝。
- `[NEEDS CLARIFICATION]`：`titleBarOverlay.height = 40` 与渲染层自绘标题栏高度的视觉对齐，需在真实 Windows 环境实测确认。

## 8. 文件清单

| 文件 | 用途 | 行数 |
|------|------|------|
| `src/main/windows.ts` | 主窗口创建 + 安全加固 + 无边框标题栏 + 窗口控制 IPC + 关窗即退出 | 136 |

> 协作方（非本模块）：`src/preload/index.ts`（暴露 `window.dsh`，21 行）、`src/main/index.ts`（编排，79 行）。

## 9. 与规格的交叉引用

| 规格需求 | 实现位置 |
|----------|----------|
| FR-103-001（无边框 + 自绘标题栏） | `frame:false` + `titleBarOverlay`（windows.ts:73-82） |
| FR-103-002（非 Windows 隐藏标题栏） | `titleBarStyle: 'hidden'`（windows.ts:83） |
| FR-103-003（同源加载 localhost） | `win.loadURL(url)`（windows.ts:127） |
| FR-103-004（降级 dev server / 兜底页） | `else if` / `else` 分支（windows.ts:128-132） |
| FR-103-005（渲染隔离） | `contextIsolation:true` / `nodeIntegration:false` / `sandbox:true`（windows.ts:86-88） |
| FR-103-006（preload 最小暴露） | `preload` 指向 `preload.js`（windows.ts:85）+ preload/index.ts 白名单 |
| FR-103-007（导航加固） | `will-navigate`（windows.ts:97-101） |
| FR-103-008（新窗口一律 deny） | `setWindowOpenHandler`（windows.ts:93-96） |
| FR-103-009（权限白名单三条件） | `setPermissionRequestHandler`（windows.ts:105-111） |
| FR-103-010（窗口控制 IPC） | `registerWindowIpcHandlers`（windows.ts:42-58） |
| FR-103-011（关窗退出） | close 放行（windows.ts，无拦截逻辑） |
| FR-103-013（就绪后显示） | `ready-to-show`（windows.ts:134） |
| FR-103-014（加载失败记录） | `did-fail-load`（windows.ts:121-123） |
