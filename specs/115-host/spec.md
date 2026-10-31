# Host 宿主 功能规格

> Module: 115-host
> Status: Implemented（已消费 dsh：runProfile('desktop') 挂起 Host，渲染进程同源加载 dsh UI）
> Last Updated: 2026-08-14

## 1. 模块概述

### 1.1 目的（Why this module exists）

在桌面应用的**主进程内**启动并挂起 deepseek-harness（dsh）的 Host（宿主，含内置 webserver），
使其 webserver 绑定一个空闲端口，并向桌面壳提供：

1. **宿主上下文**（`ctx`）——可供桌面能力（托盘、通知）直接订阅宿主事件；
2. **同源加载地址**（`http://127.0.0.1:<port>/`）——供窗口模块加载 dsh Web UI；
3. **优雅关闭句柄**（`shutdown`）——应用退出时释放宿主资源。

模块的核心价值是「就绪判定」：桌面壳必须先拿到 Host 的**实际绑定端口**，
才能在窗口创建时用正确的 localhost 地址加载界面。这是「双门就绪」策略（参考 opencode desktop）的宿主侧。

> **当前状态说明**：脚手架阶段 dsh 尚未接入，`startHost()` 直接返回 `null`（空句柄）。
> 模块的**对外契约**（接口、句柄结构、返回 null 的约定）已定型并可用，
> 但**尚未真正拉起 dsh Host**。主进程据此显示兜底页，不阻塞 Electron 启动。
> 真正的 dsh 启动逻辑以 TODO 注释 + 源码级引用（runProfile、webserver 端口语义）的形式固化在本模块中。

### 1.2 解决的问题（What pain points it addresses）

- **避免自定义协议 / 鉴权 / CORS 三件套**：dsh 的 webserver 同源服务 SPA dist 与 `/api`，
  渲染进程直接加载 localhost 即同源，fetch `/api` 与 WebSocket `/api/events.mux` 均无需 CORS、无需鉴权、
  无需自定义协议。宿主模块通过提供 localhost 地址，使「零 CORS、零鉴权、零自定义协议、零新 IPC 载体」成为可能。
- **避免端口冲突**：使用「端口 0 = 由 OS 分配」语义，宿主绑定空闲端口并回传实际端口，杜绝固定端口占用/冲突。
- **避免加载竞争**：宿主先就绪（拿到端口）→ 再建窗加载，杜绝渲染进程在宿主未就绪时的加载竞态。
- **优雅释放**：通过 `shutdown` 句柄在退出时 dispose 插件树，避免宿主资源泄漏。

### 1.3 范围（Scope）

**包含**：

- 启动宿主的统一入口（`startHost`）及其返回值契约（宿主句柄 / 空句柄）；
- 宿主上下文的最小接口定义（webserver 端口 + 事件订阅）；
- 就绪判定（拿到实际端口、拼出同源加载 URL）；
- 优雅关闭句柄的暴露。

**不包含**：

- 窗口创建与加载（见 `103-window-shell`）；
- 系统托盘、原生通知（见后续模块 `tray` / `notifications`，它们只是**消费**本模块的 `ctx`）；
- dsh 自身功能（agent、session、工具调用等，全部由 dsh 提供，桌面壳不实现）。

## 2. 用户故事

- 作为用户，我希望桌面应用启动后能在进程内拉起 dsh Host 并绑定一个空闲端口，使界面能够被加载，而无需我手动启动 `dsh web`。
- 作为用户，我希望界面功能 100% 沿用 dsh 标准 Web UI，不出现桌面壳二次封装的行为差异。
- 作为用户，我希望关闭/退出应用时，Host 资源被优雅释放，不留僵尸进程或端口占用。
- 作为（桌面能力的）开发者，我希望拿到宿主的上下文，以便直接订阅宿主事件（如会话结束、审批请求）来驱动托盘与通知。

## 3. 功能需求

### 3.1 宿主启动

- FR-115-001：系统 MUST 提供统一的宿主启动入口，在桌面应用进程内启动 dsh Host。
- FR-115-002：系统 MUST 让宿主的 webserver 绑定一个**空闲端口**（以「端口 0 = OS 分配」方式），并取得实际绑定端口。
- FR-115-003：系统 MUST 采用 `desktop` profile 启动宿主（复用 `dsh-base` + `dsh-web-app` 组合，并关闭 URL 打印）。

### 3.2 就绪判定与句柄

- FR-115-004：系统 MUST 在宿主就绪后返回一个宿主句柄，至少包含：宿主上下文（`ctx`）、优雅关闭（`shutdown`）、实际端口（`port`）、同源加载地址（`url`）。
- FR-115-005：系统 MUST 以 `http://127.0.0.1:<实际端口>/` 形式构造同源加载地址。

### 3.3 事件订阅与优雅关闭

- FR-115-006：系统 MUST 通过宿主上下文暴露事件订阅能力，供托盘 / 通知等桌面能力订阅宿主事件。
- FR-115-007：系统 MUST 提供优雅关闭句柄，调用后释放（dispose）宿主插件树。

### 3.4 降级契约

- FR-115-008：在 dsh 未构建 / 产物缺失 / 启动失败时，系统 MUST 返回空句柄（`null`）而非阻塞应用启动，使主进程能够显示兜底页继续运行。

## 4. 关键实体

| 实体 | 说明 | 关键属性 |
|------|------|----------|
| 宿主句柄（HostHandle） | 主进程持有的 dsh Host 句柄 | `ctx`（上下文）、`shutdown`（优雅关闭）、`port`（实际端口）、`url`（同源加载地址） |
| 宿主上下文（HostContext） | dsh Cordis Context 的最小接口（脚手架占位） | `webServer.port`（webserver 端口）、`on`（事件订阅） |

## 5. 验收场景

### 场景：宿主启动成功

- Given 桌面应用启动，dsh 已接入（消费阶段）
- When 调用宿主启动入口
- Then 返回宿主句柄，其 `port` 为 OS 分配的实际端口，`url` 为 `http://127.0.0.1:<port>/`；主进程可据此加载界面

### 场景：宿主未接入（脚手架阶段）

- Given dsh 尚未接入
- When 调用宿主启动入口
- Then 返回空句柄（`null`），应用启动不被阻塞，主进程显示兜底页

### 场景：优雅关闭

- Given 宿主已启动并返回句柄
- When 应用退出时调用 `shutdown`
- Then 宿主插件树被释放，无资源泄漏

### 场景：事件订阅

- Given 宿主已启动
- When 桌面能力通过 `ctx.on` 订阅宿主事件
- Then 宿主事件发生时监听器被触发（用于驱动通知/托盘）

## 6. 非功能需求

- **性能**：宿主启动应高效完成；桌面壳自身不引入额外等待（「就绪后建窗」避免无效轮询）。
- **可移植性**：宿主进程边界应设计为可迁移到子进程/独立进程，迁移对渲染进程（只认 localhost）透明。
- **可维护性**：对 dsh 的依赖以「源码引用 + 最小接口」封装，接口集中在本模块，便于跟随 dsh 上游迭代。
- **安全性**：宿主仅绑定回环地址（127.0.0.1），不对局域网/公网暴露。

## 7. 假设与约束

- **假设**：dsh 的 webserver 支持「端口 0 → OS 分配」并回传实际端口（源码级核实：`packages/host/webserver/src/index.ts:78-81`）。
- **假设**：`runProfile` 返回 `{ ctx, shutdown }`，其中 `shutdown` 提供 `shutdown(code?)` 方法（`apps/cli/src/profile-boot.ts:207`）。
- **约束（已知代价）**：Host 运行在主进程内，宿主崩溃 = 应用级崩溃（MVP 已接受的代价，后续可迁移到 utilityProcess）。
- **约束（MVP 已确认）**：裁掉 dsh 原生沙箱（landlock），规避 Electron Node ABI 不一致问题。
- **约束**：dsh 与本工程同级目录、源码引用（非 npm 包、非 submodule），构建前需先对 dsh 执行 `pnpm install` + `build:lib:host` + `build:web`。

## 8. 依赖

**上游（被本模块消费）**：

- deepseek-harness（dsh）—— `runProfile`（`apps/cli/src/profile-boot.ts`）、webserver（`dsh-host-webserver`）、`desktop` profile（`profiles/desktop`）。脚手架阶段尚未真正 import。

**下游（消费本模块）**：

- `103-window-shell`：使用宿主的 `url` 加载界面；宿主为 null 时使用兜底页。
- `tray` / `notifications`（后续模块）：使用宿主的 `ctx` 订阅事件。
- `index`（启动编排）：调用 `startHost()` 并决定后续建窗、托盘、通知流程。
