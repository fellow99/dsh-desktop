# 113-tray 技术方案（As-Built）

> 本文档是对 113-tray 模块实际架构、设计决策与实现策略的回顾性技术方案。
> Module: 113-tray
> 对应规格：specs/113-tray/spec.md
> Last Updated: 2026-08-14

## 1. 技术上下文

### 1.1 运行环境 — 代码在哪里运行

- **进程**：Electron 主进程（Node.js，也承载 dsh Host）。
- **源文件**：`src/main/tray.ts`（41 行），由 `src/main/index.ts` 在启动编排中调用。
- **平台**：Windows + Linux（macOS 后续考虑）。

### 1.2 依赖 — 直接与间接依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| Electron | `^43.4.0` | `app`、`Menu`、`nativeImage`、`Tray`、`BrowserWindow`（类型） |
| TypeScript | `^5.6.0` | 类型安全（strict） |

> 本模块无第三方运行时依赖，仅使用 Electron 内置 API。

## 2. 宪法合规检查

对照 `specs/constitution.md`：

| 原则 | 状态 | 说明 |
|---|---|---|
| 架构宪法 · 只写装配代码 | ✅ | 仅用 Electron `Tray`/`Menu` 装配壳层能力，不触碰 dsh 业务 |
| 生命周期宪法 · 关窗退出 | ✅ | 关窗即退出由入口模块处理；本模块提供托盘「退出」等效退出入口 |
| 生命周期宪法 · 优雅关闭 | ✅ | `before-quit` 中调用 `destroyTray()` 释放托盘（index.ts:73-78） |
| 代码质量 · TypeScript strict / 无 as any | ✅ | 全程显式类型，无 `as any` / `@ts-ignore` |
| 代码质量 · 无空 catch | ✅ | 无 catch 块 |

## 3. 研究结论

- **托盘 API 选型**：使用 Electron 内置 `Tray` + `Menu.buildFromTemplate`，无第三方托盘库。理由：需求极简（两菜单项 + 点击唤起），内置 API 足够且零依赖。
- **唤起窗口的健壮性**：`showWindow` 先 `isMinimized()` 判空再 `restore()`，再 `show()` + `focus()`——覆盖「最小化」与「隐藏」两种状态（实现 FR-113-005）。
- **占位图标决策**：脚手架阶段用 `nativeImage.createEmpty()` 生成空图标占位（tray.ts:11-12，注释 `TODO(资源)`），保证 `Tray` 可构造；真实图标后续放入 `resources/`。
- **单例引用管理**：模块级 `let tray: Tray | null = null`，`createTray` 赋值、`destroyTray` 置 null，避免悬挂引用（实现 FR-113-008）。

## 4. 数据模型

### 4.1 实体定义

| 名称 | 类型 | 说明 |
|---|---|---|
| `tray` | `Tray \| null`（模块级） | 托盘单例引用；null 表示未创建 |
| `mainWindow` | `BrowserWindow`（函数入参） | 托盘操作的目标窗口 |
| `icon` | `nativeImage` | 占位空图标（`nativeImage.createEmpty()`） |

### 4.2 状态转换

```
tray = null ──createTray(mainWindow)──▶ tray = Tray 实例（驻留）
tray = Tray 实例 ──destroyTray()──────▶ tray = null（应用退出）
```

> 与窗口生命周期的协作：关窗即退出由入口模块的 `window-all-closed` 触发；托盘「退出」→ `app.quit()` → `before-quit` → `destroyTray()`（与关窗退出等效）。

## 5. 接口契约

### 5.1 提供的接口（导出）

| 导出 | 签名 | 说明 |
|---|---|---|
| `createTray` | `(mainWindow: BrowserWindow) => Tray` | 创建托盘 + 菜单 + 点击监听，返回 Tray 实例（实现 FR-113-001/003/004/005/006） |
| `destroyTray` | `() => void` | 销毁托盘并置 null（实现 FR-113-008） |

### 5.2 消费的接口（导入）

| 来源 | 说明 |
|---|---|
| `electron`（`app`、`Menu`、`nativeImage`、`Tray`、`BrowserWindow` 类型） | 托盘、菜单、应用退出 |
| `src/main/index.ts` | 调用 `createTray(mainWindow)`（宿主就绪后）与 `destroyTray()`（before-quit） |

### 5.3 事件协议

| 事件 | 触发方 | 处理 |
|---|---|---|
| `tray.on('click')` | 用户点击托盘图标 | `showWindow()`：还原 + 显示 + 聚焦（实现 FR-113-004/005） |
| 菜单「显示主窗口」click | 用户选择菜单项 | `showWindow()`（实现 FR-113-003/005） |
| 菜单「退出」click | 用户选择菜单项 | `app.quit()`（实现 FR-113-006/007） |

## 6. 实现策略

### 6.1 架构模式

单文件模块 + 模块级单例：`createTray`/`destroyTray` 两个导出函数封装托盘生命周期，无类、无状态存储，符合「只写装配代码」原则。

### 6.2 关键逻辑

`showWindow`（tray.ts:15-19）：最小化判断 → 还原 → 显示 → 聚焦，四步保证窗口必被唤回并置于前台。

`setToolTip`（tray.ts:21）：设置悬浮提示 `'DSH Desktop'`（实现 FR-113-002）。

### 6.3 错误处理

本模块无异步操作、无 IO、无异常路径，故无显式错误处理（符合「无空 catch」——没有 catch 是因为没有可捕获的失败分支）。

### 6.4 性能

托盘创建为一次性开销，驻留期间仅内存持有 `Tray` 引用，无轮询、无定时器。

## 7. 测试考量

- **单元测试建议**：用 Electron 测试框架 mock `Tray`/`Menu`/`app`，验证：
  - `createTray` 调用 `new Tray` 且菜单模板含「显示主窗口」「退出」两项。
  - 点击「退出」回调调用 `app.quit()`。
  - `destroyTray` 后模块态为 null。
- **边界情况**：`mainWindow.isMinimized()` 为 true/false 两分支的 `showWindow` 行为；`destroyTray` 在 `tray` 为 null 时的空安全（`tray?.destroy()`）。
- **脚手架阶段**：`npm run typecheck` 作为基本质量门。

## 8. 文件清单

| 文件 | 用途 | 行数 |
|---|---|---|
| `src/main/tray.ts` | 托盘创建/销毁、菜单、点击唤起 | 41 |

## 9. 交叉引用（spec → 实现）

| 需求 ID | 实现位置 |
|---|---|
| FR-113-001 | tray.ts:10-13（`createTray` → `new Tray`），由 index.ts:54-55 在宿主就绪后调用 |
| FR-113-002 | tray.ts:21（`setToolTip`） |
| FR-113-003 | tray.ts:24（菜单「显示主窗口」） |
| FR-113-004 | tray.ts:34（`tray.on('click', showWindow)`） |
| FR-113-005 | tray.ts:15-19（`showWindow`：restore + show + focus） |
| FR-113-006 | tray.ts:26-30（菜单「退出」） |
| FR-113-007 | tray.ts:28-30（`app.quit()`） |
| FR-113-008 | tray.ts:38-41（`destroyTray`），由 index.ts:77 在 before-quit 调用 |
