# 116-notification 技术方案（As-Built）

> 本文档是对 116-notification 模块实际架构、设计决策与实现策略的回顾性技术方案。
> Module: 116-notification
> 对应规格：specs/116-notification/spec.md
> Last Updated: 2026-08-14

## 1. 技术上下文

### 1.1 运行环境 — 代码在哪里运行

- **进程**：Electron 主进程（Node.js，也承载 dsh Host）。
- **源文件**：`src/main/notifications.ts`（70 行），由 `src/main/index.ts` 在宿主就绪后调用。
- **平台**：Windows + Linux（macOS 后续考虑）。
- **事件源**：dsh Host 的 Cordis Context 事件（进程内直接订阅，不经 HTTP/WS）。

### 1.2 依赖 — 直接与间接依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| Electron | `^43.4.0` | `Notification` |
| deepseek-harness (dsh) | 源码引用（同级目录） | 事件源（`ctx.on`） |
| `./host`（本地） | — | `HostContext` 类型（最小占位接口） |

## 2. 宪法合规检查

对照 `specs/constitution.md`：

| 原则 | 状态 | 说明 |
|---|---|---|
| 架构宪法 · 零上游改动 | ✅ | 复用 dsh 现有 `ctx.on` 事件，不新写载体、不 fork UI |
| 架构宪法 · 同源数据面 | ✅ | 主进程**进程内**直接订阅 ctx，不经过 HTTP/WS 数据面 |
| 架构宪法 · 只写装配代码 | ✅ | 仅把 host 事件映射到 Electron `Notification` |
| 代码质量 · TypeScript strict / 无 as any | ✅ | 使用结构化类型断言 `event as SessionEventLike`（非 `as any`），无 `@ts-ignore` |
| 代码质量 · 无空 catch | ✅ | 无 catch 块 |
| 安全宪法 · 权限白名单 | ✅（间接） | 主进程 `Notification` 不受渲染进程权限白名单约束；渲染进程的 `notifications` 权限白名单（windows.ts）与本模块相互独立 |

## 3. 研究结论

- **事件源源码级核实**（notifications.ts 注释，2026-08-14）：
  - `session/event` 的 `turn/end` 事件，`reason.kind ∈ completed|aborted|blocked|error|max-tokens|interrupted`（`packages/core/session/src/types.ts:252, 155-174`）。
  - `approval/asked` 事件由 dsh-user-approval 插件增广，`data = { id, toolName, callId?, reason? }`（`packages/interaction/user-approval/src/index.ts:44-49`）。
  - `agent/status`：`{ agent, status }`，`status ∈ 'idle' | 'running'`（代码注释已记录，但当前实现未订阅）。
  - `agent/error`：`{ agent, turn, step, error }`。
  - question 通知：host ctx 层无事件，唯一来源是 `apiProxy.events.mux` 流的 `question/requested` 帧（`packages/host/apiproxy/src/api/events.ts:74`）。
- **触发策略决策**：`turn/end` 仅对 `completed` / `error` 弹通知，其余 `reason.kind`（aborted/blocked/max-tokens/interrupted）静默——避免非关键结束产生噪音（实现 FR-116-003）。
- **事件载荷占位**：`SessionEventLike` 为最小结构占位，`switch (e.type)` 匹配 `'turn/end'` / `'approval/asked'`，其余 `default` 静默（实现 FR-116-001/002/004）。
- **Windows AppUserModelID**：Windows 原生通知需 `app.setAppUserModelId('com.fellow99.dsh.desktop')`（index.ts:42），在 `whenReady` 后、注册通知前设置（实现 FR-116-008 的平台侧支撑）。

## 4. 数据模型

### 4.1 实体定义

| 名称 | 类型 | 说明 |
|---|---|---|
| `SessionEventLike` | interface | 会话事件最小结构（占位）：`type`、`reason?.kind`、`data?.{id?, toolName?, reason?}` |
| `HostContext` | interface（`./host`） | `webServer.port` + `on(event, listener)` |

### 4.2 事件载荷映射

| 事件 | 载荷 | 通知标题 | 通知正文 |
|---|---|---|---|
| `session/event` `turn/end`（kind=`completed`） | `reason.kind` | `DeepSeek Harness` | `Agent 已完成本轮任务` |
| `session/event` `turn/end`（kind=`error`） | `reason.kind` | `DeepSeek Harness` | `Agent 执行出错` |
| `session/event` `turn/end`（其它 kind） | — | — | 静默 |
| `session/event` `approval/asked` | `data.toolName` | `DeepSeek Harness — 需要审批` | 有工具名：`工具「{toolName}」请求执行`；无：`有操作需要你的确认` |
| `agent/error` | — | `DeepSeek Harness — Agent 错误` | `Agent 运行出错，请查看应用详情` |

### 4.3 状态转换

本模块无内部状态机；订阅注册为一次性动作，注册后长期存活直至进程退出。

## 5. 接口契约

### 5.1 提供的接口（导出）

| 导出 | 签名 | 说明 |
|---|---|---|
| `setupNotifications` | `(ctx: HostContext) => void` | 注册 `session/event` 与 `agent/error` 订阅（实现 FR-116-001~006） |

### 5.2 消费的接口（导入）

| 来源 | 说明 |
|---|---|
| `electron`（`Notification`） | 原生通知 |
| `./host`（`HostContext` 类型） | 宿主上下文类型 |

### 5.3 事件协议（订阅的宿主事件）

| 事件 | 监听器签名 | 处理 |
|---|---|---|
| `session/event` | `(session, event) => void` | `switch(e.type)`：`turn/end`（completed/error 弹通知，其余静默）、`approval/asked`（弹通知）、default 静默 |
| `agent/error` | `(agent, error) => void` | 弹兜底通知 |

> **未订阅**（已记录但未实现）：`agent/status`（idle/running）——代码注释记录，但当前无对应通知需求。
> **不可用**：question 通知无 host ctx 事件源（见 §3）。

## 6. 实现策略

### 6.1 架构模式

单函数订阅注册模式：`setupNotifications(ctx)` 一次注册两个 `ctx.on` 监听，回调内用 `switch` 按事件类型分发。无类、无状态。

### 6.2 关键逻辑

- `turn/end` 分支（notifications.ts:33-48）：读 `e.reason?.kind`，仅 `'completed'` / `'error'` 构造并 `show()` 通知，其余类型落入默认静默（实现 FR-116-001/002/003）。
- `approval/asked` 分支（notifications.ts:49-58）：`e.data?.toolName` 存在则正文含工具名，否则通用文案（实现 FR-116-004/005）。
- `agent/error` 分支（notifications.ts:64-69）：独立兜底通知（实现 FR-116-006）。
- 未使用参数以 `_` 前缀标记（`_session`、`_agent`、`_error`），满足 strict 无未使用参数告警。

### 6.3 错误处理

订阅回调内无可能抛出的 IO/异步操作；宿主事件监听异常由宿主侧事件系统处理，本模块不捕获（无 catch，符合「无空 catch」）。

### 6.4 性能

通知为事件驱动、一次性构造 `Notification` 并 `show()`，无轮询、无缓存、无定时器。

## 7. 测试考量

- **单元测试建议**：注入 mock `HostContext`（可捕获 `on` 注册的回调），验证：
  - `session/event` 的 `turn/end` + `completed` → 发出「完成」通知。
  - `turn/end` + `error` → 发出「出错」通知。
  - `turn/end` + 其它 kind → 不发出通知。
  - `approval/asked` 有/无 `toolName` 两条文案分支。
  - `agent/error` → 发出兜底通知。
  - 未知事件类型 → 静默。
- **集成测试建议**：宿主接入后，用真实 `ctx` 触发一次 turn 结束，断言通知落地（或对 `Notification` mock）。
- **边界情况**：`e.reason` 为 undefined 时 `kind` 为空 → 落入静默；`e.data` 为 undefined 时正文用通用文案。
- **脚手架阶段**：`npm run typecheck` 作为基本质量门。当前宿主为 null，`setupNotifications` 未被调用（index.ts:54-57 的 `if (host)` 守卫）。

## 8. 文件清单

| 文件 | 用途 | 行数 |
|---|---|---|
| `src/main/notifications.ts` | 订阅 host 事件 → 原生通知 | 70 |

## 9. 交叉引用（spec → 实现）

| 需求 ID | 实现位置 |
|---|---|
| FR-116-001 | notifications.ts:36-40（`turn/end` + `completed`） |
| FR-116-002 | notifications.ts:41-46（`turn/end` + `error`） |
| FR-116-003 | notifications.ts:33-48（switch 仅 completed/error 弹通知，其余静默）+ default 分支 |
| FR-116-004 | notifications.ts:49-58（`approval/asked`） |
| FR-116-005 | notifications.ts:53-55（`toolName` 三元分支） |
| FR-116-006 | notifications.ts:64-69（`agent/error`） |
| FR-116-007 | index.ts:54-57（`if (host)` 守卫，仅宿主就绪后调用 `setupNotifications`） |
| FR-116-008 | index.ts:42（`app.setAppUserModelId(...)`） |
