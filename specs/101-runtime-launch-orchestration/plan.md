> ⚠️ **变更（011-version-0.1.5，2026-09-13）**：窗口已改为**常规 Windows 标题栏（`frame:true`）**；已移除自定义窗口控制 IPC（`registerWindowIpcHandlers` / `window:*`）与 preload 的 `window.dsh`，并新增**主窗口状态持久化**与 **F11 全屏**。本文档为改造前的 as-built 记录；与当前代码不一致处，以 `src/main/windows.ts`、`src/main/window-state.ts`、`src/preload/index.ts` 及 `specs/011-version-0.1.5/spec.md` 为准。

# 101-runtime-launch-orchestration 技术方案（As-Built）

> 本文档是对实际架构、设计决策与实现策略的回顾性技术方案。
> Module: 101-runtime-launch-orchestration（应用入口编排）
> Corresponding spec: [spec.md](./spec.md)
> Last Updated: 2026-08-14

## 1. Technical Context

### 1.1 Runtime Environment — 代码在哪里运行

- **进程**：Electron 主进程（Node.js 运行时，同时承载 dsh Host）。
- **入口**：`src/main/index.ts`（构建产物 `.vite/build/main.js`，`package.json` 的 `main` 字段指向）。
- **模块系统**：CommonJS（tsconfig commonjs，由 Forge Vite 插件编译）。

### 1.2 Dependencies — 直接依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| electron | `^43.4.0` | `app`（生命周期/单实例/退出）、`BrowserWindow`（激活判断） |
| electron-squirrel-startup | `^1.0.1` | 识别 Squirrel.Windows 安装/卸载短生命周期，返回真时退出 |
| `./lifecycle`（内部） | — | `setupSystemCertificates` / `ensureLoopbackNoProxy` / `installCrashHandlers` |
| `./host`（内部） | — | `startHost`、`HostHandle` 类型 |
| `./windows`（内部） | — | `createMainWindow` / `registerWindowIpcHandlers` |
| `./tray`（内部） | — | `createTray` / `destroyTray` |
| `./notifications`（内部） | — | `setupNotifications` |

## 2. Constitution Compliance

| 原则 | 状态 | 说明 |
|---|---|---|
| 零上游改动 | ✅ | 仅装配，不引入新的数据载体 |
| 进程内 Host（MVP） | ✅ | `startHost()` 在主进程内调用，`host` 句柄由入口持有 |
| 只写装配代码 | ✅ | 入口仅按序调用各模块，不含能力实现 |
| 同源数据面 | ✅ | 通过 `host.url`（`http://127.0.0.1:<port>/`）交给窗口模块加载 |
| 单实例锁 | ✅ | `app.requestSingleInstanceLock()`，失败即 `app.quit()`（实现 FR-101-001） |
| 关窗退出 | ✅ | `window-all-closed` → `app.quit()`（实现 FR-101-011） |
| 优雅关闭 | ✅ | `before-quit` → `host?.shutdown()` + `destroyTray()`（实现 FR-101-012） |
| TypeScript strict / 无 as any | ✅ | 无类型压制；electron-squirrel-startup 以静态 import 引入（类型声明于 src/electron-squirrel-startup.d.ts） |
| 严禁空 catch | ✅ | 入口无 try/catch |

## 3. Research Findings

- **单实例 + 第二实例聚焦**：采用 Electron 官方 `requestSingleInstanceLock` 模式，在 `second-instance` 事件中 `restore`（若最小化）→ `show` → `focus`。锁申请失败分支直接 `app.quit()`，保证无窗口时代码不继续执行。
- **Squirrel.Windows 处理**：`electron-squirrel-startup` 必须在入口最前调用——安装/卸载时进程带特殊参数被拉起，若返回真则立即 `app.quit()`，避免弹出窗口（对应 Forge `maker-squirrel` 的 Windows 安装器分发）。
- **启动顺序（双门就绪，参考 opencode）**：`whenReady` 内先 `setAppUserModelId` → `registerWindowIpcHandlers` → `await startHost()` → `createMainWindow(host?.url ?? null)` → `createTray`/`setupNotifications`。保证窗口加载时宿主已就绪或明确兜底。
- **托盘/通知依赖宿主上下文**：`createTray` 需要 `mainWindow`，`setupNotifications` 需要 `host.ctx`；两者均包裹在 `if (host)` 内，宿主不可用（脚手架返回 null）时跳过。
- **`activate` 重建窗口**：macOS 习惯 + 兜底——所有窗口关闭后点击 Dock/再次激活时重建主窗口（用当前 `host?.url`）。

## 4. Data Model

模块级状态（非导出，模块内生命周期共享）：

| 变量 | 类型 | 说明 |
|---|---|---|
| `mainWindow` | `BrowserWindow \| null` | 主窗口引用，初始 null |
| `host` | `HostHandle \| null` | 宿主句柄，初始 null；`startHost()` 返回 |

（无跨模块退出标志——关窗即退出，`window-all-closed` 触发 `app.quit()`）

状态迁移：

```
进程启动 → gotLock? ──否→ quit
                └─是→ Squirrel? ──是→ quit
                         └─否→ 安全准备 → whenReady
                                 → host = startHost()（null 或 句柄）
                                 → mainWindow = createMainWindow(host?.url)
                                 → (host 非空) createTray + setupNotifications
                                 → 运行中 → window-all-closed → app.quit → before-quit → host.shutdown + destroyTray
```

## 5. Interface Contracts

### 5.1 Provided Interfaces — 本模块对外提供

无导出符号。本模块为进程入口（`main` 指向的构建产物），以「副作用」形式编排其它模块。

### 5.2 Consumed Interfaces — 本模块消费

| 接口 | 来源 | 签名（要点） |
|---|---|---|
| `setupSystemCertificates` | `./lifecycle` | `(): void` |
| `ensureLoopbackNoProxy` | `./lifecycle` | `(): void` |
| `installCrashHandlers` | `./lifecycle` | `(): void` |
| `startHost` | `./host` | `(): Promise<HostHandle \| null>` |
| `createMainWindow` | `./windows` | `(url: string \| null): BrowserWindow` |
| `registerWindowIpcHandlers` | `./windows` | `(): void` |
| `createTray` | `./tray` | `(mainWindow: BrowserWindow): Tray` |
| `destroyTray` | `./tray` | `(): void` |
| `setupNotifications` | `./notifications` | `(ctx: HostContext): void` |
| `app` / `BrowserWindow` | electron | 生命周期与窗口 API |

### 5.3 Event Protocols — 事件订阅

| 事件 | 来源 | 处理 |
|---|---|---|
| `second-instance` | electron app | 还原/显示/聚焦主窗口（FR-101-002） |
| `activate` | electron app | 无窗口时重建主窗口（FR-101-010） |
| `window-all-closed` | electron app | `app.quit()`，关窗即退出（FR-101-011） |
| `before-quit` | electron app | `host?.shutdown()` + `destroyTray()`（FR-101-012） |

## 6. Implementation Strategy

### 6.1 Architecture Pattern — 实际采用模式

线性编排（orchestration）：入口以「同步判断 + 异步主流程 + 事件注册」三段式组织，所有能力委托给独立模块，入口自身不承载业务逻辑。

### 6.2 Key Algorithms — 关键逻辑

- **单实例锁失败分流**：`if (!gotLock) app.quit() else { ... }`，整个主流程包裹在 `else` 分支，保证锁失败后不执行任何启动代码。
- **宿主就绪 vs 兜底**：`createMainWindow(host?.url ?? null)` —— 空值合并传递，把「宿主不可用」决策下放到窗口模块（兜底页加载）。
- **优雅关闭**：`void host?.shutdown()` 非阻塞触发（可选链 + void），随后同步 `destroyTray()`。

### 6.3 Error Handling — 错误传播

- 入口无显式 try/catch；进程级 `uncaughtException` / `unhandledRejection` 兜底由 `lifecycle.ts` 注册（入口在启动前调用 `installCrashHandlers`）。
- 宿主启动失败（未来消费 dsh 后）预期由 `startHost` 大声失败/返回 null，入口降级为兜底页，不阻塞启动。

### 6.4 Performance

- 单实例锁、Squirrel 判断在最早阶段执行，失败路径零初始化开销。
- 启动序列中仅 `await startHost()` 一处异步等待；窗口创建、托盘/通知装配在宿主就绪后串行进行。

## 7. Testing Considerations

- **可测试性**：编排逻辑适合以「调用顺序」为单位做集成/契约测试（mock 各模块后断言调用次序与条件分支）。
- **建议测试类别**：
  - 单实例：锁失败 → 不调用任何启动函数；锁成功 + `second-instance` → 聚焦现有窗口。
  - 编排顺序：whenReady 后调用次序为 `setAppUserModelId → registerWindowIpcHandlers → startHost → createMainWindow → createTray → setupNotifications`。
  - 宿主不可用：`startHost` 返回 null → `createMainWindow(null)` 被调用，`createTray`/`setupNotifications` 不被调用。
  - 优雅关闭：`before-quit` → `host.shutdown()` 与 `destroyTray()` 被调用。
- **边界场景**：`activate` 在已有窗口时不应重建；`second-instance` 在主窗口为 null（极早退出竞态）时不应抛错。

## 8. File Inventory

| 文件 | 用途 | 行数 |
|---|---|---|
| `src/main/index.ts` | 进程入口：单实例锁、启动编排、生命周期 | 79 |
