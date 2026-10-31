> ⚠️ **变更（011-version-0.1.5，2026-09-13）**：窗口已改为**常规 Windows 标题栏（`frame:true`）**；已移除自定义窗口控制 IPC（`registerWindowIpcHandlers` / `window:*`）与 preload 的 `window.dsh`，并新增**主窗口状态持久化**与 **F11 全屏**。相关模块文档为改造前的 as-built 记录；与当前代码不一致处，以 `src/main/windows.ts`、`src/main/window-state.ts`、`src/preload/index.ts` 及 `specs/011-version-0.1.5/spec.md` 为准。

# 规格文档索引

**项目名称：** dsh-desktop
**版本：** 0.2.1
**技术栈：** Electron + Electron Forge + Vite + TypeScript（封装 deepseek-harness）
**文档生成时间：** 2026-08-14
**最后更新：** 2026-11-01（按父工程编号规则整理：0XX 公共 / 1XX 基础 / 2XX 插件）

---

## 一、文档总览

| 层级 | 分类 | 文档数量 | 说明 |
|------|------|---------|------|
| 整体 | 项目级顶层文档 | 9 | 索引、清单、结构、技术、架构、宪法、overall-* |
| 模块 | 公共需求模块（0XX） | 4 | 012-building-workflow、013-branding 各 spec + plan |
| 模块 | 基础功能模块（1XX） | 16 | 101/103/105/113/114/115/116/118 共 8 个模块，各 spec + plan |
| 模块 | 插件模块（2XX） | 4 | 201-dsh-market（spec + plan + tasks + test-cases） |
| **合计** | **11 模块目录 / 33 文件**（含 README 索引） | | |

> 注：本项目级规格文档集不含 `API.md`、`overall-api.md`、`overall-test-cases.md`——数据面在 dsh 侧，桌面壳无自有 API 清单，这些文档尚未生成。
> 编号规则见父工程 [`../../specs/constitution.md`](../../specs/constitution.md)：`0XX` = 各子工程公共需求，`1XX` = 本工程基础功能，`2XX` = 补丁/插件。本工程基础模块编号以 `dsh-desktop-android` 为基准对齐。

---

## 二、项目级顶层文档

全局性的架构、技术、宪法等文档，定义项目基线和开发准则。

| 文档 | 路径 | 说明 |
|------|------|------|
| **方案总纲** | [ARCHITECTURE.md](./ARCHITECTURE.md) | 系统整体架构设计（进程模型、分层、数据流、关键决策） |
| **宪法原则** | [constitution.md](./constitution.md) | 项目开发原则、编码规范、治理规则、编号规则 |
| **整体规格** | [overall-spec.md](./overall-spec.md) | 系统级功能规格（技术无关） |
| **整体方案** | [overall-plan.md](./overall-plan.md) | 系统级技术方案（各模块 plan 总纲） |
| **技术选型** | [TECH.md](./TECH.md) | 核心技术栈选型理由、版本、依赖说明 |
| **项目结构** | [STRUCTURE.md](./STRUCTURE.md) | 源码目录结构、进程入口、关键配置 |
| **数据模型** | [overall-data-model.md](./overall-data-model.md) | 全局数据实体、状态机、事件流定义 |
| **检查清单** | [SPECS_CHECKLIST.md](./SPECS_CHECKLIST.md) | 规格文档完成度追踪 |

---

## 三、公共需求模块（0XX）

### 012 — 构建工作流（building-workflow）

> GitHub Actions 的 CI（typecheck）与 release（三平台打包 + 产物上传）流水线；与父工程 `012-building-workflow` 同号。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [012-building-workflow/spec.md](./012-building-workflow/spec.md) | 构建工作流功能规格 |
| 技术方案 | [012-building-workflow/plan.md](./012-building-workflow/plan.md) | 构建工作流技术实现方案 |

### 013 — 品牌化（branding）

> 产品身份：应用名、安装包/窗口/托盘图标、favicon；物料源为父工程 `assets/`，桌面侧以复制 + 引用接线实现。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [013-branding/spec.md](./013-branding/spec.md) | 品牌化功能规格 |
| 技术方案 | [013-branding/plan.md](./013-branding/plan.md) | 品牌化技术实现方案 |

---

## 四、基础功能模块（1XX）

> 原 `001-008` 已按父工程规则迁移到 1XX，编号与 `dsh-desktop-android` 基准对齐；迁移映射见本节末尾。

### 101 — 应用入口编排 / 运行时启动（runtime-launch-orchestration）

> 进程级入口编排器：单实例锁、安装器短生命周期处理、启动编排（安全准备 → 宿主 → 窗口 → 托盘/通知）、生命周期（关窗退出 + 优雅退出）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [101-runtime-launch-orchestration/spec.md](./101-runtime-launch-orchestration/spec.md) | 应用入口编排功能规格 |
| 技术方案 | [101-runtime-launch-orchestration/plan.md](./101-runtime-launch-orchestration/plan.md) | 应用入口编排技术实现方案 |

### 103 — 窗口外壳（window-shell）

> BrowserWindow 创建、loadURL(localhost)/兜底页、安全加固、窗口状态持久化、F11 全屏、关窗即退出。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [103-window-shell/spec.md](./103-window-shell/spec.md) | 窗口外壳功能规格 |
| 技术方案 | [103-window-shell/plan.md](./103-window-shell/plan.md) | 窗口外壳技术实现方案 |

### 105 — 上游适配层（upstream-adapter-bundle）

> 自定义 dsh 桌面 profile：声明式复用 web 组合（dsh-base + dsh-web-app），通过 patch 关闭 URL 打印，端口由启动代码注入。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [105-upstream-adapter-bundle/spec.md](./105-upstream-adapter-bundle/spec.md) | 上游适配层功能规格 |
| 技术方案 | [105-upstream-adapter-bundle/plan.md](./105-upstream-adapter-bundle/plan.md) | 上游适配层技术实现方案 |

### 113 — 系统托盘（tray）

> 系统托盘（退出/唤回）；托盘菜单（显示主窗口 / 退出）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [113-tray/spec.md](./113-tray/spec.md) | 系统托盘功能规格 |
| 技术方案 | [113-tray/plan.md](./113-tray/plan.md) | 系统托盘技术实现方案 |

### 114 — 生命周期与安全（lifecycle-safety）

> NO_PROXY 并入 loopback、系统 CA 合并、崩溃兜底（uncaughtException/unhandledRejection）、优雅关闭。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [114-lifecycle-safety/spec.md](./114-lifecycle-safety/spec.md) | 生命周期与安全功能规格 |
| 技术方案 | [114-lifecycle-safety/plan.md](./114-lifecycle-safety/plan.md) | 生命周期与安全技术实现方案 |

### 115 — Host 宿主（host）

> 在主进程内 `runProfile('desktop')` 挂起 dsh Host（含 webserver），返回 Host 句柄（ctx/shutdown/port/url）；就绪判定。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [115-host/spec.md](./115-host/spec.md) | Host 宿主功能规格 |
| 技术方案 | [115-host/plan.md](./115-host/plan.md) | Host 宿主技术实现方案 |

### 116 — 原生通知（notification）

> 订阅宿主 ctx 的 session/event 与 agent/error 事件 → Electron 原生通知。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [116-notification/spec.md](./116-notification/spec.md) | 原生通知功能规格 |
| 技术方案 | [116-notification/plan.md](./116-notification/plan.md) | 原生通知技术实现方案 |

### 118 — 薄 IPC 桥（preload-bridge）

> contextBridge 暴露 `window.dsh`（窗口控制 min/max/close/isMaximized）。**历史模块**：011-version-0.1.5 起窗口改为系统标题栏，运行时已不再依赖该桥；规格保留作演进记录。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [118-preload-bridge/spec.md](./118-preload-bridge/spec.md) | 薄 IPC 桥功能规格 |
| 技术方案 | [118-preload-bridge/plan.md](./118-preload-bridge/plan.md) | 薄 IPC 桥技术实现方案 |

### 编号迁移映射（001-008 → 1XX）

| 旧编号 | 新编号 | 模块 |
|--------|--------|------|
| 001-host | 115-host | Host 宿主 |
| 002-window | 103-window-shell | 窗口外壳 |
| 003-tray | 113-tray | 系统托盘 |
| 004-notification | 116-notification | 原生通知 |
| 005-lifecycle | 114-lifecycle-safety | 生命周期与安全 |
| 006-preload | 118-preload-bridge | 薄 IPC 桥 |
| 007-app-entry | 101-runtime-launch-orchestration | 应用入口编排 |
| 008-desktop-profile | 105-upstream-adapter-bundle | 上游适配层 |

---

## 五、插件模块（2XX）

### 201 — dsh-market 插件市场（dsh-market）

> 把 dsh-market（可视化插件市场）内置到桌面封装的 dsh 环境，随 Host 自动加载，并在开发态/打包态打通安装、删除、配置插件通道（便携 Node + pnpm + dsh CLI）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [201-dsh-market/spec.md](./201-dsh-market/spec.md) | dsh-market 集成功能规格（含实现与调试记录） |
| 技术方案 | [201-dsh-market/plan.md](./201-dsh-market/plan.md) | dsh-market 集成技术实现方案（含实现偏差记录） |
| 任务拆解 | [201-dsh-market/tasks.md](./201-dsh-market/tasks.md) | 开发任务与打包态调试修复任务（全部完成） |
| 测试用例 | [201-dsh-market/test-cases.md](./201-dsh-market/test-cases.md) | 功能/打包态/负向用例与实测结果 |

---

## 六、模块编号一览

| 编号 | 模块名 | 英文名 | 分类 |
|------|--------|--------|------|
| 012 | 构建工作流 | building-workflow | 公共需求 |
| 013 | 品牌化 | branding | 公共需求 |
| 101 | 应用入口编排 / 运行时启动 | runtime-launch-orchestration | 基础功能 |
| 103 | 窗口外壳 | window-shell | 基础功能 |
| 105 | 上游适配层 | upstream-adapter-bundle | 基础功能 |
| 113 | 系统托盘 | tray | 基础功能 |
| 114 | 生命周期与安全 | lifecycle-safety | 基础功能 |
| 115 | Host 宿主 | host | 基础功能 |
| 116 | 原生通知 | notification | 基础功能 |
| 118 | 薄 IPC 桥 | preload-bridge | 基础功能 |
| 201 | dsh-market 插件市场 | dsh-market | 插件 |

> 注：编号中如有跳号，为父工程统一目录预留（102 载荷管线、104 宿主能力桥、106 工作区选择、107 诊断、108 合规发布、109 保活、110 pnpm、111 构建管线、112 tool-bash、117 运行时供给等由其他子工程占用或本工程暂无对应模块）。

---

## 七、模块文档结构规范

每个模块目录 `NNN-name/` 下包含以下标准文档：

| 文件 | 命名 | 说明 |
|------|------|------|
| 功能规格 | `spec.md` | 定义模块的功能需求、用户故事、验收标准 |
| 技术方案 | `plan.md` | 模块的技术实现方案、架构决策、组件设计 |

> 如项目需要，模块目录还可扩展以下文档：
> - `tasks.md` — 开发任务拆解、依赖关系、里程碑
> - `api.md` — 模块涉及的 API 接口定义
> - `data-model.md` — 模块所需的实体、类型、枚举定义
> - `pages.md` — 模块包含的页面路由、组件树、交互流程
> - `test-cases.md` — 模块 UI 功能测试用例

---

## 八、快速导航

| 目标读者 | 推荐阅读顺序 |
|---------|-------------|
| **新加入开发者** | constitution.md → STRUCTURE.md → overall-spec.md → 具体模块 spec.md |
| **架构师 / Tech Lead** | ARCHITECTURE.md → TECH.md → overall-plan.md |
| **桌面壳开发** | STRUCTURE.md → 对应模块的 spec.md + plan.md |
| **测试 / QA** | SPECS_CHECKLIST.md → 各模块 spec.md 验收场景 |

---

**文档维护者：** dsh-desktop 开发团队
