# 115-host 技术方案（As-Built）

> 本文档为回溯式技术方案，记录 Host 宿主模块的**实际**架构、设计决策与实现策略。
> Module: 115-host
> 对应规格: [spec.md](./spec.md)
> Last Updated: 2026-08-14

## 1. 技术上下文

### 1.1 运行时环境

- 运行于 **Electron 主进程**（Node.js 环境，Electron `^43.4.0`，内置 Node ≥ 24）。
- 主进程即 dsh Host 宿主：`runProfile('desktop')` 进程内挂起 Host 及其 webserver。
- 构建产物：经 Vite 编译后由 `src/main/host.ts` 编译进 `.vite/build/main.js`。

### 1.2 依赖

| 依赖 | 版本/来源 | 用途 |
|------|-----------|------|
| deepseek-harness（dsh） | 源码引用（同级目录 `../deepseek-harness`） | 被封装宿主；`runProfile` 来自 `apps/cli/src/profile-boot.ts` |
| `@deepseek-ai/dsh-app-boot` | dsh 内部 | `runProfile` / `boot` / profile 机制（本模块封装入口） |
| `@deepseek-ai/dsh-host-webserver` | dsh 内部 | 服务 SPA dist + `/api`，支持 `--port 0` → OS 分配 |
| `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` | dsh 内部 | `desktop` profile 的 bundles |
| Cordis | dsh 内置 | 「一切皆插件」依赖注入框架（`ctx` 即 Cordis Context） |

> 注：当前脚手架阶段上述 dsh 依赖**均未 import**（startHost 返回 null）；上述为计划中的消费关系。

## 2. 宪法合规检查

| 原则 | 状态 | 说明 |
|------|------|------|
| 架构：零上游改动 | ✅ | 复用 `runProfile` / webserver 路由，无 fork、无新载体 |
| 架构：进程内 Host（MVP） | ✅ | `startHost()` 设计为在主进程内 `runProfile('desktop')` |
| 架构：只写装配代码 | ✅ | 仅封装 `runProfile` + 读端口 + 拼 URL，无业务逻辑 |
| 架构：同源数据面 | ✅ | `url = http://127.0.0.1:<port>/`（实现 FR-115-005） |
| 安全：只绑回环地址 | ✅ | webserver 绑定 `127.0.0.1`，不对外暴露 |
| 代码质量：TypeScript strict / 无 as any | ✅ | 仅定义最小接口 `HostContext` / `HostHandle`，无类型压制 |
| 代码质量：源码即真理 | ✅ | dsh 引用均标注源码文件+行号（profile-boot.ts:207 等） |
| 生命周期：优雅关闭 | ✅ | 暴露 `shutdown` 句柄（`ProcessShutdown.shutdown`） |
| 生命周期：崩溃兜底 | ⚠️ 部分 | 进程内 Host 崩溃=应用崩溃（已知代价）；兜底在 `lifecycle.ts`，非本模块职责 |

> 合规结论：全部 ✅ / ⚠️ 可解释，无 ❌。

## 3. 研究结论

### 3.1 关键决策与理由

| 决策 | 理由 |
|------|------|
| 进程内 `runProfile('desktop')` | 直连 `ctx` 订阅 `session/event` 最省事；渲染进程只认 localhost，迁移 utilityProcess 透明 |
| `--port 0`（OS 分配端口） | 规避固定端口冲突；dsh webserver `config.port` 为 0 时返回实际端口（`webserver/src/index.ts:78-81`） |
| 返回 `HostHandle`（而非裸 ctx） | 封装 `port`/`url`/`shutdown`，屏蔽 dsh 细节，下游窗口/通知模块只依赖稳定句柄 |
| `HostContext` 用最小接口占位 | 脚手架阶段不 import dsh 真实类型；消费后替换为 `@deepseek-ai/dsh-*` 真实 Context 类型 |
| 脚手架返回 null（降级契约） | 主进程据 `host?.url ?? null` 走兜底页，不阻塞 Electron 启动 |

### 3.2 源码级核实（固化于 `src/main/host.ts` 注释）

- `runProfile(options): Promise<{ ctx; shutdown: ProcessShutdown }>` —— `apps/cli/src/profile-boot.ts:207`。
- `RunProfileOptions = { environment, profile, patchFiles, args }` —— `profile-boot.ts:174-183`。
- webserver 端口 0 语义 —— `packages/host/webserver/src/index.ts:78-81`。
- 调用示例（`environment` 用 `loadLayeredEnv('dsh')`）—— `apps/cli/src/bin.ts:31-38`。

### 3.3 消费 dsh 的实现（已落地）

`startHost()` 动态 import dsh 编译产物（与 dsh CLI `bin.js` 一致），调用 `runProfile('desktop')`：

```ts
const { runProfile } = await import(pathToFileURL(entry).href);      // apps/cli/lib/profile-boot-*.js（薄入口）
const { loadLayeredEnv } = await import(pathToFileURL(DSH_APP_BOOT_LIB).href);  // dsh-app-boot/lib/index.js
const { ctx, shutdown } = await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: 'desktop',
  patchFiles: [],
  args: ['--port', '0'],
});
```

**Electron 兼容处理**（dsh loader 依赖 Node 内部 API，Electron 下不可用）：

1. **独立 DSH_HOME**：`process.env.DSH_HOME = userData/.dsh`，避免污染 `~/.dsh`；启动前把
   `profiles/desktop` 复制到 `$DSH_HOME/profiles/desktop`（dsh 对未知 profile 默认仅 `dsh-base`）。
2. **workspace 包链接**：loader 的 internal import 依赖 `node-addon-require-builtin`（Electron V8
   缺 `GetAlignedPointerFromEmbedderData` 符号）失效，回退默认 ESM import；故把 dsh workspace 包
   链接到其根 node_modules（`ensureWorkspaceLinks`）。
3. **禁用 HMR**：`cordis-plugin-hmr` 需 `--expose-internals`，设 `DSH_DISABLE_HMR=1` 跳过
   runProfile 的 watch-only HMR 挂载（dsh 本地 patch，见 README「开发」章节）。
4. **产物定位**：tsdown 每次构建生成新 hash 产物、旧产物残留，按 mtime 选最新薄入口。

## 4. 数据模型

### 4.1 实体定义（`src/main/host.ts`）

```ts
export interface HostContext {
  webServer: { port: number };
  on(event: string, listener: (...args: unknown[]) => void): void;
}

export interface HostHandle {
  ctx: HostContext;
  shutdown: (code?: number) => Promise<void> | void;
  port: number;
  url: string;
}
```

### 4.2 状态转换

```
startHost() ──(脚手架)──→ null
            ──(消费 dsh)──→ HostHandle（port/url 可用）
                              └─ shutdown(code?) ──→ disposed（插件树释放）
```

### 4.3 校验规则

- `port`：OS 分配的正整数，来自 `ctx.webServer.port`（非硬编码、非固定）。
- `url`：严格 `http://127.0.0.1:<port>/` 形式（回环地址，不含主机名 localhost，避免歧义）。
- `shutdown`：允许返回 `void` 或 `Promise<void>`，适配 dsh `ProcessShutdown.shutdown` 签名差异；可选 `code` 参数，缺省 0。

## 5. 接口契约

### 5.1 提供接口（本模块导出）

| 导出 | 类型 | 说明 |
|------|------|------|
| `startHost()` | `() => Promise<HostHandle \| null>` | 启动宿主；脚手架返回 null |
| `HostHandle` | interface | 宿主句柄 |
| `HostContext` | interface | 宿主上下文最小接口 |

### 5.2 消费接口（本模块 import）

| 来源 | 符号 | 说明 |
|------|------|------|
| `deepseek-harness/apps/cli/src/profile-boot` | `runProfile`, `loadLayeredEnv` | 脚手架阶段**未 import**（计划中） |

### 5.3 事件协议

- `ctx.on(event, listener)`：订阅 dsh host 事件（Cordis `ctx.on`）。桌面侧 `notifications` 将订阅 `session/event`（`turn/end`、`approval/asked`）与 `agent/error`。
- 本模块不产生自有事件，仅透传宿主事件订阅能力。

## 6. 实现策略

### 6.1 架构模式

**门面（Facade）+ 降级占位**：`startHost()` 是对 dsh `runProfile` 的薄门面；当前以 `return null` 占位，
真实启动逻辑以 TODO 注释固化，保持对外契约（返回类型、句柄结构）稳定，消费 dsh 时仅替换函数体。

### 6.2 关键算法

- **就绪判定**：`await runProfile(...)` 完成后即视为就绪（`ctx.webServer.port` 已可用）；无轮询、无超时重试。
- **URL 构造**：模板字符串 `http://127.0.0.1:${port}/`（实现 FR-115-005）。

### 6.3 错误处理

- 脚手架阶段：无错误路径（恒返回 null）。
- 消费后：webserver 监听失败（如 EADDRINUSE）由 dsh boot 大声失败上报，本模块不吞错、不静默降级（除非未来明确需兜底）。
- 优雅关闭：`shutdown(code?)` 透传 `shutdown.shutdown(code ?? 0)`。

### 6.4 性能

- 端口 0 规避端口冲突重试；宿主启动与建窗解耦（就绪后才建窗），无忙等。

## 7. 测试考虑

- **类型检查**：`npm run typecheck`（脚手架阶段基本质量门）。
- **单元（消费后）**：`startHost` 返回句柄的 port/url 拼装正确性；`shutdown` 透传。
- **集成（消费后）**：`runProfile` + 就绪判定冒烟；`toFetchHandler` 冒烟。
- **边界**：端口 0 → OS 分配非固定端口；重复启动端口不冲突；`shutdown` 幂等（重复调用不抛异常，`[NEEDS CLARIFICATION]`：dsh `ProcessShutdown.shutdown` 是否幂等未核实）。

## 8. 文件清单

| 文件 | 用途 | 行数 |
|------|------|------|
| `src/main/host.ts` | 宿主启动门面：`HostContext`/`HostHandle` 接口 + `startHost()`（脚手架返回 null）+ dsh 源码引用注释 | 56 |

> 消费方（非本模块）：`src/main/index.ts`（编排）、`src/main/notifications.ts`（消费 ctx）、`src/main/tray.ts`（依赖窗口）。

## 9. 与规格的交叉引用

| 规格需求 | 实现位置 |
|----------|----------|
| FR-115-001（统一启动入口） | `startHost()`（host.ts:54） |
| FR-115-002（空闲端口） | `args: ['--port', '0']` + 读 `ctx.webServer.port`（TODO 注释） |
| FR-115-003（desktop profile） | TODO 注释第 2 步（profiles/desktop） |
| FR-115-004（返回句柄） | `HostHandle` 接口（host.ts:22-30） |
| FR-115-005（同源 URL） | `url: http://127.0.0.1:${port}/`（host.ts:29 注释 / TODO） |
| FR-115-006（事件订阅） | `HostContext.on`（host.ts:18） |
| FR-115-007（优雅关闭） | `HostHandle.shutdown`（host.ts:25） |
| FR-115-008（脚手架返回 null） | `startHost()` 函数体 `return null`（host.ts:54-56） |
