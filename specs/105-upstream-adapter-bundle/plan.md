# 105-upstream-adapter-bundle 技术方案（As-Built）

> 本文档是对实际架构、设计决策与实现策略的回顾性技术方案。
> Module: 105-upstream-adapter-bundle（desktop profile）
> Corresponding spec: [spec.md](./spec.md)
> Last Updated: 2026-08-14

## 1. Technical Context

### 1.1 Runtime Environment — 代码在哪里运行

- **形态**：纯声明式配置（JSON + YAML），无运行时代码。
- **位置**：`profiles/desktop/`（桌面工程内，随应用分发）。
- **消费方**：由宿主启动模块通过 `runProfile('desktop', ...)` 加载（见 `src/main/host.ts` 的 TODO 注释）。

### 1.2 Dependencies — 直接依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| `@deepseek-ai/dsh-base` | dsh 源码引用 | profile 的基础面 bundle |
| `@deepseek-ai/dsh-web-app` | dsh 源码引用 | profile 的浏览器面 bundle（含 web-runtime 行） |
| Cordis（dsh 内置） | dsh 内置 | patch 语法与覆盖机制 |

> 上述 dsh 包为声明式引用（bundles 名），未在桌面工程 `package.json` 中安装，属消费 dsh 后生效。

## 2. Constitution Compliance

| 原则 | 状态 | 说明 |
|---|---|---|
| 零上游改动 | ✅ | profile 与 patch 均在桌面工程内，不改 dsh 源码 |
| 只写装配代码 | ✅ | 纯配置装配，复用现有 bundle，无自定义插件代码 |
| 同源数据面 | ✅ | 复用 web-app bundle 的 webserver，不改变数据面载体 |
| 进程内 Host（MVP） | ✅ | profile 本身与进程模型无关，由宿主启动模块决定 |
| TypeScript strict / 无 as any | ✅ | 无 TS 代码 |
| 源码即真理 | ⚠️ | patch 基线依赖 dsh 上游 web-app bundle 的 cordis.patch.yml（消费 dsh 后核实，见 §3） |

## 3. Research Findings

- **A1 vs A2 决策（产品概念设计第 11 节）**：选定 A1——新建独立 `desktop` profile（`dsh.profile.bundles = [dsh-base, dsh-web-app]`），而非 A2（直接复用 `web` profile + `--patch`）。理由：干净、可演进，不依赖 `web` profile 内部行 id 稳定。
- **`dsh.profile` 字段**：`package.json` 中的 `dsh.profile.bundles` 数组声明组合（对应 FR-105-001）。
- **patch 语法（cordis）**：覆盖行以 `id` 定位、整块替换 config——本工程的 `cordis.patch.yml` 以 `id: web-runtime` 定位 web-app bundle 的 web-runtime 行，整块替换为 `{ printUrl: false, surfaceContext: true, trustedHosts: !!js ctx.webStartup.trustedHosts }`。
- **printUrl 覆盖（对应 FR-105-003/004）**：仅 `printUrl: true → false`；`surfaceContext` 与 `trustedHosts` 保持原值（`surfaceContext: true`、`trustedHosts` 用 `!!js` 表达式从 `ctx.webStartup` 取值）。
- **端口注入（对应 FR-105-005）**：webserver 端口由启动代码经 `--port 0` 注入，web-app bundle 的 webserver 行 `port: !!js ctx.webStartup.port ?? 3080` 已支持，故无需在 patch 中覆盖端口。
- **注入点**：patch 声明 `inject: [webStartup]`，即对 web-app bundle 的 webStartup 注入点生效。

## 4. Data Model

### 4.1 文件 `profiles/desktop/package.json`

| 字段 | 值 | 说明 |
|---|---|---|
| `name` | `dsh-desktop-profile` | profile 工程名 |
| `private` | `true` | 不发布 |
| `dsh.profile.bundles` | `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]` | 组合声明（FR-105-001） |

### 4.2 文件 `profiles/desktop/cordis.patch.yml`

| 字段 | 值 | 说明 |
|---|---|---|
| `id` | `web-runtime` | 定位 web-app bundle 的 web-runtime 行 |
| `name` | `@deepseek-ai/dsh-web-app` | 目标 bundle |
| `inject` | `[webStartup]` | 注入点 |
| `config.printUrl` | `false` | 关闭 URL 打印（FR-105-003） |
| `config.surfaceContext` | `true` | 保持原值（FR-105-004） |
| `config.trustedHosts` | `!!js ctx.webStartup.trustedHosts` | 保持原值（FR-105-004） |

## 5. Interface Contracts

### 5.1 Provided Interfaces — 本模块对外提供

| 接口 | 形态 | 说明 |
|---|---|---|
| `desktop` profile | `dsh.profile.bundles` + `cordis.patch.yml` | 供宿主的 profile 机制发现/加载 |
| web-runtime 覆盖 | patch 配置 | 供 cordis patch 机制在装配时应用 |

### 5.2 Consumed Interfaces — 本模块消费

| 接口 | 来源 | 说明 |
|---|---|---|
| `dsh.profile.bundles` 机制 | dsh profile 机制 | 声明组合 |
| cordis patch 机制 | dsh/Cordis | 行级覆盖 |
| `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` | dsh 上游 | 被组合的 bundle |

### 5.3 Event Protocols — 无

本模块为纯配置，无事件/协议。

## 6. Implementation Strategy

### 6.1 Architecture Pattern — 实际采用模式

声明式装配（declarative composition）：以 JSON 声明组合、以 YAML patch 声明覆盖，无任何自定义运行时代码。

### 6.2 Key Algorithms — 关键逻辑

- **覆盖定位**：patch 用 `id`（`web-runtime`）精确定位目标行，整块替换 config，避免逐字段合并的歧义。
- **上下文取值**：`trustedHosts` 用 `!!js ctx.webStartup.trustedHosts` 表达式在装配期从上下文取值，而非写死（保持与上游原值一致，FR-105-004）。

### 6.3 Error Handling

- 纯配置无运行时错误路径；patch 与上游行 id 不匹配时由 cordis 装配过程报错（消费 dsh 后验证）。

### 6.4 Performance

- 配置仅影响宿主装配期，无运行时开销。

## 7. Testing Considerations

- **可测试性**：profile 正确性在宿主装配期验证——加载 `desktop` profile 后，组合包含 dsh-base 与 dsh-web-app，且 web-runtime 的 printUrl 为 false。
- **建议测试类别**：
  - 集成：`runProfile('desktop')` 后断言 bundles 装配成功（消费 dsh 后）。
  - 行为：启动后控制台无「dsh web: http://...」输出（FR-105-003）。
  - 端口：`--port 0` 下 `ctx.webServer.port` 为 OS 分配端口（FR-105-005）。
- **边界场景**：patch 覆盖后 `surfaceContext`/`trustedHosts` 未失真（FR-105-004）；上游 web-app bundle 行 id 变更时 patch 失配的提示。

## 8. File Inventory

| 文件 | 用途 | 行数 |
|---|---|---|
| `profiles/desktop/package.json` | 声明 `desktop` profile 的组合（bundles） | 9 |
| `profiles/desktop/cordis.patch.yml` | 覆盖 web-runtime 的 printUrl 等配置 | 19 |
