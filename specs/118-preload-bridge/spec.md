> ⚠️ **变更（011-version-0.1.5，2026-09-13）**：窗口已改为**常规 Windows 标题栏（`frame:true`）**；已移除自定义窗口控制 IPC（`registerWindowIpcHandlers` / `window:*`）与 preload 的 `window.dsh`，并新增**主窗口状态持久化**与 **F11 全屏**。本文档为改造前的 as-built 记录；与当前代码不一致处，以 `src/main/windows.ts`、`src/main/window-state.ts`、`src/preload/index.ts` 及 `specs/011-version-0.1.5/spec.md` 为准。

# 006 薄 IPC 桥 规格说明

> 模块：118-preload-bridge（薄 IPC 桥）
> 状态：Implemented（脚手架阶段已实现）
> 最后更新：2026-08-14

## 1. 模块概述

### 1.1 目的 —— 为什么存在这个模块

本模块通过 preload 桥向渲染进程暴露一个极小的 `window.dsh` API，用于无边框窗口的窗口控制（最小化 / 最大化 / 关闭 / 查询最大化状态）。这是主进程与渲染进程之间唯一的 IPC 通道，且严格限定为「壳层关注点」——**业务数据面（对话、文件等）完全不过 IPC**，走同源的 HTTP + WebSocket。

### 1.2 解决的问题

- 无边框窗口（无系统标题栏）需要自绘标题栏，渲染进程必须能触发最小化 / 最大化 / 关闭。
- 在 `sandbox:true + contextIsolation:true + nodeIntegration:false` 的安全基线下，渲染进程无法直接访问 Electron 能力，必须经 `contextBridge` 受控暴露。
- 数据面若走 IPC 会引入新载体、违背「零上游改动」原则；薄 IPC 把 IPC 面收敛到最小。

### 1.3 范围

**包含**：`window.dsh` 的窗口控制能力（minimize / maximize / close / isMaximized）。

**不包含**：业务数据传输（走同源 HTTP + WebSocket）、其它 shell 能力（对话框 / 存储 / 更新 / 深链等，本模块均不暴露）、主进程侧窗口控制 handler 的实现（属窗口模块）。

## 2. 用户故事

- 作为用户，我可以在无边框窗口中通过自绘标题栏按钮控制窗口最小化、最大化/还原、关闭。
- 作为前端开发者，我可以在宿主 Web UI 页面中调用 `window.dsh` 控制窗口，实现自绘标题栏与无边框窗口的视觉一体。

## 3. 功能需求

### 3.1 窗口控制暴露

- FR-118-001：系统 MUST 通过 preload 桥向渲染进程暴露窗口控制能力（最小化、最大化、关闭、查询最大化状态）。
- FR-118-002：系统 MUST 保证每个窗口控制操作都有对应的主进程异步处理，并以异步方式（返回 Promise）交付结果。
- FR-118-003：系统 MUST 使最大化操作支持切换语义（已最大化则还原，未最大化则最大化）。

### 3.2 数据面隔离

- FR-118-004：系统 MUST 保证业务数据（对话、文件等）不经过 IPC，而走同源的 HTTP + WebSocket 通道。
- FR-118-005：系统 MUST 将 IPC 暴露面收敛到最小——仅壳层关注点，不向渲染进程暴露 Node 能力。

### 3.3 作用域

- FR-118-006：系统 MUST 使暴露的 API 对该窗口加载的所有页面（含宿主 Web UI 页面）可用。

## 4. 关键实体

| 实体 | 描述 | 关键属性 |
|---|---|---|
| `window.dsh` API | 暴露给渲染进程的窗口控制接口 | `minimize` / `maximize` / `close`（无返回值）+ `isMaximized`（返回布尔） |

## 5. 验收场景

### 场景：自绘标题栏控制窗口

- Given 无边框窗口已加载，渲染进程可访问 `window.dsh`
- When 渲染进程调用 `window.dsh.minimize()` / `window.dsh.close()`
- Then 对应窗口被最小化 / 触发关闭流程

### 场景：最大化切换

- Given 窗口当前未最大化
- When 渲染进程调用 `window.dsh.maximize()`
- Then 窗口最大化；再次调用则还原（非最大化状态）

### 场景：查询最大化状态

- Given 窗口处于某最大化状态
- When 渲染进程调用 `window.dsh.isMaximized()`
- Then 返回与当前窗口状态一致的布尔值

### 场景：数据面不过 IPC

- Given 渲染进程发起业务数据请求
- When 请求发出
- Then 该请求走同源 HTTP / WebSocket，而非 `window.dsh` 或其它 IPC 通道

## 6. 非功能需求

- **安全性**：最小暴露面——不向渲染进程暴露 Node 能力；仅暴露无参数、无敏感信息的窗口控制方法。
- **类型安全**：暴露的 API 具备可推导的类型，便于渲染进程调用。
- **一致性**：窗口控制能力与主进程侧 handler 一一对应，无孤立的无效通道。

## 7. 假设与约束

- **假设**：渲染进程运行在 `sandbox:true + contextIsolation:true + nodeIntegration:false` 基线，只能经 `contextBridge` 受控获取能力。
- **约束**：preload 脚本对「该窗口加载的所有页面」生效，包括 loadURL 到 localhost 的宿主 Web UI——即宿主 UI 也可经 `window.dsh` 控制无边框窗口。

## 8. 依赖

- **上游**：主进程窗口模块（`src/main/windows.ts`）注册的窗口控制 IPC handler（本模块的调用目标）。
- **下游 / 消费者**：渲染进程（宿主 dsh Web UI 或兜底页）调用 `window.dsh`。
- **参考**：opencode desktop 的「薄 IPC（窗口/对话框/store/更新/深链），数据面不过 IPC」模式（本项目仅实现窗口控制子集）。
