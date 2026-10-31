# 105-upstream-adapter-bundle 模块规格

> Module: 105-upstream-adapter-bundle（desktop profile）
> Status: Implemented
> Last Updated: 2026-08-14

## 1. Module Overview

### 1.1 Purpose — 为什么存在这个模块

本模块为被封装的宿主（deepseek-harness，dsh）定义一个名为 `desktop` 的自定义 profile：复用 web 组合（基础面 + 浏览器面），并将组合微调为「桌面应用」形态。它让桌面壳无需改造 dsh 上游即可按桌面语义启动宿主。

### 1.2 Problems Solved — 解决的问题

- **复用 vs 重造**：桌面壳需要 dsh 的 Web 界面，但不应重新拼装一份插件组合。通过声明式复用 web 组合的两个 bundle，零重复、零 fork。
- **控制台噪音**：dsh web 组合默认会打印「dsh web: http://...」URL 行，这是面向命令行 `dsh web` 的行为，对桌面应用无意义且泄漏端口信息。通过 patch 关闭该打印。
- **端口注入**：桌面壳需要 webserver 绑定空闲端口（由启动代码经 `--port 0` 注入），profile 自身不应写死端口，也不需为此额外 patch。
- **可演进性**：相比直接复用 `web` profile（依赖其内部行 id 稳定），独立 profile 更干净、可演进。

### 1.3 Scope — 范围

**包含**：

- 声明 `desktop` profile 的插件组合（bundles）
- 通过 patch 覆盖 web-runtime 的 URL 打印行为

**不包含**：

- 宿主的实际启动/就绪逻辑（宿主启动模块）
- webserver 端口绑定实现（dsh webserver 自身，端口由启动代码注入）
- 其它桌面能力（托盘/通知/窗口等，各自模块）

## 2. User Stories

- 作为桌面应用，我希望以「web 组合 + 桌面微调」的方式启动宿主界面，而不是重新拼装插件。
- 作为桌面应用，我希望宿主启动时不向控制台打印 URL 行（桌面场景无意义）。
- 作为桌面应用，我希望 webserver 端口由启动时动态决定（空闲端口），profile 不写死端口。

## 3. Functional Requirements

### 3.1 组合声明

- FR-105-001：系统 MUST 声明一个 `desktop` profile，其插件组合为基础面（dsh-base）与浏览器面（dsh-web-app）两个 bundle。
- FR-105-002：系统 MUST 将组合声明为可被宿主的 profile 机制发现并加载的形式（随包分发）。

### 3.2 行为微调

- FR-105-003：系统 MUST 关闭 web-runtime 的 URL 打印行为（桌面应用无需打印「dsh web: http://...」）。
- FR-105-004：系统 MUST 在覆盖 URL 打印时保持 web-runtime 的其它配置项（surfaceContext、trustedHosts）原值不变。
- FR-105-005：系统 SHOULD 保持 webserver 端口由启动代码注入（`--port 0` 由 OS 分配空闲端口），不在 profile 层写死端口。

## 4. Key Entities

| 实体 | 描述 | 关键属性 |
|---|---|---|
| profile | 宿主插件组合的命名配置 | 名称 `desktop`；bundles 列表 |
| patch | 对特定插件行的用户级覆盖 | 定位 id、注入点、覆盖后的配置 |

## 5. Acceptance Scenarios

### Scenario: 组合声明正确

- Given desktop profile 被宿主加载
- When 宿主启动该 profile
- Then 插件组合包含 dsh-base 与 dsh-web-app 两个 bundle

### Scenario: URL 打印关闭

- Given 桌面应用以 desktop profile 启动宿主
- When 宿主 webserver 就绪
- Then 不再打印「dsh web: http://...」URL 行

### Scenario: 端口动态注入

- Given 桌面应用启动宿主时传入端口 0
- When webserver 绑定完成
- Then webserver 使用 OS 分配的空闲端口，且 profile 未写死任何端口

### Scenario: 其它配置不被破坏

- Given desktop profile 的 patch 覆盖了 URL 打印项
- When 该覆盖生效
- Then web-runtime 的 surfaceContext 与 trustedHosts 保持原值

## 6. Non-Functional Requirements

- **零上游改动**：profile 与 patch 完全在桌面工程内定义，不改动 dsh 仓库任何源码。
- **可演进性**：profile 独立于 dsh 内置的 `web` profile，后续可增量追加桌面专属覆盖而不影响其它 profile。
- **可维护性**：patch 语义以 id 定位、整块替换，覆盖意图在注释中明确，便于与 dsh 上游版本对齐。

## 7. Assumptions & Constraints

- 复用 web 组合（dsh-base + dsh-web-app）是既定的产品决策（产品概念设计第 11 节 A1 方案）。
- web-app bundle 的 webserver 行已支持 `port: !!js ctx.webStartup.port ?? 3080`（运行时注入），故端口无需在 profile 层 patch。[NEEDS CLARIFICATION：该行引用自 dsh 上游 web-app bundle 的 cordis.patch.yml，需在消费 dsh 源码后核实行 id 与默认值]

## 8. Dependencies

- **上游**：dsh 的 profile 机制（`dsh.profile`）、cordis patch 机制、`@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app` 两个 bundle。
- **下游**：宿主启动模块（以 `desktop` profile 名启动宿主）、打包流程（profile 文件需随包分发）。
