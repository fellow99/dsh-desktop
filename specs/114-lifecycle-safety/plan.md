# 114-lifecycle-safety 技术方案（As-Built）

> 本文档为「回溯性」技术方案，记录模块实际架构、设计决策与实现策略。
> 模块：114-lifecycle-safety
> 对应规格：specs/114-lifecycle-safety/spec.md
> 最后更新：2026-08-14

## 1. 技术上下文

### 1.1 运行时环境

- **运行位置**：Electron 主进程（Node.js 运行时，同时承载 dsh Host）。
- **Node 版本**：Electron 43 内置 Node（≥ 24），`node:tls` 提供 `getCACertificates(source)` / `setDefaultCACertificates(certs)`（Node 24.4+）。
- **调用时机**：`src/main/index.ts` 在 `app.whenReady()` 之前同步调用（第 35-37 行），其中 `ensureLoopbackNoProxy` 依赖 `app.commandLine.appendSwitch`（须在 whenReady 前生效）。

### 1.2 依赖

| 依赖 | 类型 | 用途 |
|---|---|---|
| `electron`（`app`） | 内置 | `app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>')` |
| `node:tls`（动态 `require`） | 内置 | `getCACertificates` / `setDefaultCACertificates` 合并系统 CA |
| Node `process` | 内置 | `process.env` 读写、`process.on('uncaughtException'/'unhandledRejection')` |

> 无第三方 npm 依赖，纯 Electron / Node 内置能力。

## 2. 宪法合规检查

| 宪法原则（constitution.md） | 状态 | 说明 |
|---|---|---|
| §1 架构宪法 2「进程内 Host + 可迁移进程边界」 | ✅ | 模块注释明确 host 边界预留 `utilityProcess` 迁移点（对应崩溃兜底场景） |
| §1 架构宪法 4「同源数据面」 | ✅ | 代理豁免正是为保证 loopback 同源加载不被劫持 |
| §2 安全宪法（启动安全准备） | ✅ | NO_PROXY 注入 + 系统 CA 合并属于启动期安全加固 |
| §5 生命周期宪法 3「崩溃兜底」 | ✅ | `uncaughtException` / `unhandledRejection` 记录，防静默崩溃 |
| §4 代码质量 1「严禁 as any / ts-ignore」 | ✅ | 类型断言为局部 interface 断言（`require('node:tls') as {...}`），非 `as any`；仅 eslint-disable `no-require-imports` 一行 |

## 3. 研究结论

- **参考实现**：opencode desktop 主进程（`packages/desktop/src/main/index.ts`）的 NO_PROXY / CA / 崩溃观测模式，本模块为对应映射。
- **proxy-bypass-list `<-loopback>`**：Chromium 命令行开关，`<-loopback>` 是「排除 loopback 之外的规则」的内建值，使渲染进程对 loopback 直连。
- **证书合并为何用动态 `require` + 运行时守卫**：`node:tls` 的 `getCACertificates`/`setDefaultCACertificates` 在类型定义中可能缺失（较新 API），且旧 Node 运行时不存在该函数。用 `typeof === 'function'` 守卫保证「能力缺失时降级跳过」，对应 FR-114-004。
- **NO_PROXY 大小写双键**：不同平台/工具读取 `NO_PROXY`（大写）或 `no_proxy`（小写），二者均需注入以保证兼容（FR-114-001）。

## 4. 数据模型

### 4.1 代理豁免列表

- 读取现有 `process.env[NO_PROXY | no_proxy]` → 按 `,` 拆分 → `trim` → 过滤空串 → 与 loopback 集合（`127.0.0.1`、`localhost`、`::1`）取并集 → 以 `,` 重写回环境变量。
- 去重：使用 `Set<string>`，保证幂等（重复启动不产生重复项）。

### 4.2 默认 CA 证书集

- 证书 = `default` 来源与 `system` 来源证书数组取并集（`Set<string>` 去重），再整体写回默认证书集。

## 5. 接口契约

### 5.1 提供的接口（导出函数）

| 函数 | 签名 | 说明 |
|---|---|---|
| `ensureLoopbackNoProxy` | `() => void` | 注入 NO_PROXY loopback + Chromium proxy-bypass-list |
| `setupSystemCertificates` | `() => void` | 合并系统 CA 到默认证书集（能力缺失时静默跳过） |
| `installCrashHandlers` | `() => void` | 注册 `uncaughtException` / `unhandledRejection` 记录 |

### 5.2 消费的接口

- `electron.app.commandLine.appendSwitch(switch, value)`
- `node:tls.getCACertificates(source)` / `node:tls.setDefaultCACertificates(certs)`
- `process.env`、`process.on(event, listener)`

### 5.3 事件协议

- `process` 的 `uncaughtException`（回调参数：`Error`）、`unhandledRejection`（回调参数：拒绝原因）。无自定义事件协议。

## 6. 实现策略

### 6.1 架构模式

单文件工具函数模块（`lifecycle.ts`），由启动编排在 `whenReady` 前同步调用。三个函数彼此独立、无状态、幂等。

### 6.2 关键算法

- **代理豁免合并**（对应 FR-114-001/002）：拆分 → 归一化（trim + 去空）→ 集合并集 → 回写。
- **证书合并**（对应 FR-114-003/004）：`Set([...getCACertificates('default'), ...getCACertificates('system')])` → `setDefaultCACertificates([...certs])`。

### 6.3 错误处理

- 证书合并：能力缺失时 `if` 守卫直接跳过，不抛错、不中断（FR-114-004）。
- 崩溃兜底：`console.error('[dsh-desktop] uncaughtException:' / 'unhandledRejection:')` 记录（TODO 接入日志框架后替换 console）。

### 6.4 性能

- 均为启动期一次性操作，无热路径；证书合并集合大小受系统 CA 数量约束，开销可忽略。

## 7. 测试考量

- **单元 — 代理豁免**：给定已存在 `NO_PROXY`/`no_proxy` 值，断言 loopback 被追加且去重、空项被过滤（覆盖大小写双键）。
- **单元 — 证书合并**：mock `node:tls` 使 `getCACertificates`/`setDefaultCACertificates` 存在 / 缺失两种分支，断言合并调用与降级跳过。
- **单元 — 崩溃兜底**：mock `process.on`，断言两个事件均被注册。
- **边界**：`NO_PROXY` 为 `undefined` / 空串；证书列表为空或含重复项。

## 8. 文件清单

| 文件 | 用途 | 行数 |
|---|---|---|
| `src/main/lifecycle.ts` | NO_PROXY 注入、系统 CA 合并、崩溃兜底 | 61 |

## 9. 与规格的交叉引用

| 技术决策 | 对应规格需求 |
|---|---|
| NO_PROXY 双键合并 + 去重（`ensureLoopbackNoProxy`） | FR-114-001 |
| Chromium `proxy-bypass-list <-loopback>` | FR-114-002 |
| `getCACertificates`/`setDefaultCACertificates` 合并 default+system | FR-114-003 |
| 运行时守卫降级跳过 | FR-114-004 |
| `process.on('uncaughtException')` 记录 | FR-114-005 |
| `process.on('unhandledRejection')` 记录 | FR-114-006 |
| `[dsh-desktop]` 前缀区分来源 | FR-114-007 |
