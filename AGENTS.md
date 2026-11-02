# AGENTS.md — dsh-desktop AI Agent 工作规范

> 本文件定义了本项目（`dsh-desktop`，DSH Desktop）中 AI Agent 必须遵守的规范和工作流程。
> 所有规范均基于本机实际已安装的技能（skills）编写，不含虚构内容。
> 总则见 `~/.agents/AGENTS.md`；本文件为项目级规范，冲突时以本文件为准。

---

## 一、通用规范

### 1.1 语言
- 与用户交互、编写文档、提交注释均使用**中文**。
- 代码、变量名、函数名、技术术语使用**英文**。

### 1.2 安全
- 严禁提交密钥、Token、密码、私钥等敏感信息。
- 严禁使用 `as any`、`@ts-ignore`、`@ts-expect-error` 压制类型错误。
- 严禁使用空的 `catch(e) {}` 错误处理。

### 1.3 代码质量
- 每次编辑文件后，必须运行 `lsp_diagnostics` 检查无新增错误。
- 修复 Bug 时，**只做最小改动**，严禁顺便重构。
- 禁止凭空猜测未读取的代码行为；关键接口必须对照源码核实。

### 1.4 任务管理
- 多步骤任务（2 步及以上）必须先创建 Todo 列表再执行。
- 同一时间只允许一个 `in_progress` 任务。
- 每完成一步立即标记 `completed`，不得批量标记。

### 1.5 项目背景（必读）
- 本工程是**基于 Electron 封装 deepseek-harness 的桌面版**。
- deepseek-harness 源码：`d:\GitHub\deepseek\deepseek-harness\`；文档：其 `docs/` 目录。
- 参考实现（opencode 桌面壳）：`d:\GitHub\opencode\opencode\packages\desktop\`。
- 产品概念设计见 `docs/000-产品概念设计.md`；改动架构前先读它。

---

## 二、Git 提交规范（强制使用 `git-commit` 技能）

### 2.1 确认
- 已安装 **`git-commit`** 技能（路径：`~/.agents/skills/git-commit/SKILL.md`）。✅

### 2.2 规则
1. 提交前，先加载 `git-commit` 技能获取完整规范。
2. 提交注释**必须**使用该技能规定的 [Conventional Commits](https://www.conventionalcommits.org/) 格式：`<type>[optional scope]: <description>`。
3. **只允许使用该技能规定的 type 前缀**（见下表），**严禁使用任何其它前缀**。

| type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 仅文档变更 |
| `style` | 代码格式/风格调整（不影响逻辑） |
| `refactor` | 代码重构（无功能变更、无 Bug 修复） |
| `perf` | 性能优化 |
| `test` | 添加/修改测试 |
| `build` | 构建系统或外部依赖变更 |
| `ci` | CI 配置变更 |
| `chore` | 杂项/维护任务 |
| `revert` | 回滚提交 |

### 2.3 禁止事项
- **严禁**使用上表之外的任何前缀。
- **严禁**在没有加载 `git-commit` 技能的情况下执行 Git 提交。
- **严禁**使用 `--no-verify` 跳过 Git Hooks（除非用户明确要求）。

---

## 三、代码库探索规范（强制使用 `codegraph-cli` 技能）

### 3.1 确认
- 已安装 **`codegraph-cli`** 技能。✅

### 3.2 规则
当任务涉及以下场景时，**必须优先使用 `codegraph-cli`**：
- 理解代码库结构（"X 是如何工作的？"、"Y 在哪里定义的？"）
- 查找符号定义、调用关系、影响范围、请求流程
- 分析变更影响（"改了这个函数什么会坏？"）

**使用原则**：项目存在 `.codegraph/` 索引时优先用 codegraph，回退到 grep + Read 仅用于未覆盖的细节确认。

| 场景 | 命令 |
|------|------|
| 探索功能区域 | `codegraph context "<任务描述>"` |
| 查找符号定义 | `codegraph query <符号名>` |
| 谁调用了 X | `codegraph callers <符号名>` |
| X 调用了谁 | `codegraph callees <符号名>` |
| 变更影响范围 | `codegraph impact <符号名>` |
| 索引状态 / 增量更新 | `codegraph status` / `codegraph sync` |

### 3.3 索引自动更新（post-commit 钩子）——【强制】
- 本工程已建立 `.codegraph/` 代码地图；git **`post-commit` 钩子**已安装，每次 commit 后自动 `codegraph sync` 增量更新索引。
- 钩子非阻塞、失败只写日志（`logs/codegraph-sync.log`）、绝不阻断提交。
- Agent 也应在大规模变更后手动 `codegraph sync` 保持索引新鲜。

---

## 四、产品/需求规划阶段（强制使用 `brainstorming` 技能）

### 4.1 确认
- 已安装 **`brainstorming`** 技能（路径：`~/.agents/skills/brainstorming/SKILL.md`）。✅

### 4.2 规则
当任务处于产品/需求规划阶段时（将模糊想法转化为完整设计、需求探索与方案比选、新功能概念设计、多方案权衡），**必须使用 `brainstorming` 技能**。

### 4.3 执行流程
```
探索项目上下文 → 逐轮提问澄清 → 提出 2-3 个方案 → 逐节展示设计 → 用户审批 → 编写设计文档 → 自审 → 用户审阅 → 进入实现
```

### 4.4 硬性关卡
> **在设计方案被用户批准之前，严禁进入任何实现阶段。** 即使是"简单"项目也必须经过设计审批。

### 4.5 设计文档输出
```
docs/superpowers/specs/YYYY-MM-DD-<主题>-design.md
```
（用户指定位置时以用户为准，例如 `docs/000-产品概念设计.md`。）

---

## 五、规格说明规范（强制使用 speckit 技能套件）

### 5.1 确认
- 已安装 **speckit** 系列技能。✅

### 5.2 技能清单

| 技能 | 用途 |
|------|------|
| `speckit-specify` | 从自然语言需求生成功能规格说明书（spec.md） |
| `speckit-clarify` | 识别规格模糊点，通过提问澄清（可选） |
| `speckit-plan` | 从 spec.md 生成技术实现方案（plan.md） |
| `speckit-tasks` | 从 plan.md 生成可执行任务列表（tasks.md） |
| `speckit-analyze` | 跨工件一致性分析（spec ↔ plan ↔ tasks，可选） |
| `speckit-checklist` | 生成自定义质量检查清单（可选） |
| `speckit-implement` | 按 tasks.md 逐任务执行实现 |
| `speckit-constitution` | 创建/更新项目宪法原则 |
| `speckit-baseline` | 分析现有源码生成功能规格（逆向规格） |
| `speckit-taskstoissues` | 将 tasks.md 转换为 GitHub Issues |

### 5.3 标准规格化流程（技能链）

```
speckit-specify → speckit-clarify（可选） → speckit-plan → speckit-tasks → speckit-analyze（可选） → speckit-checklist（可选）
```

开发阶段：
```
speckit-implement → 按 tasks.md 逐任务执行实现
```

### 5.4 使用原则
- **每个技能依赖前一个的输出**，缺失前置工件会导致后续技能报错。
- **speckit-clarify 不是必须的**：仅在 spec.md 中有 `[NEEDS CLARIFICATION]` 标记且确实需要用户决策时才使用。
- **speckit-implement 前必须确保 tasks.md 存在且完整**。

---

## 六、规范文档编写（强制使用 `specs-as-built` 技能）

### 6.1 确认
- 已安装 **`specs-as-built`** 技能。✅

### 6.2 规则
当任务涉及以下场景时，**必须使用 `specs-as-built`**：
- 为现有代码库编写架构文档、技术规格文档
- 逆向工程生成规范文档（spec.md、plan.md）
- 重构前需要基线文档、接手遗留代码后整理文档
- 编写整体系统规格（overall-spec.md、overall-plan.md）

### 6.3 执行原则
- **源码即真理**：文档中每一条声明都必须可追溯到实际源代码。
- **不可臆测**：模块行为不明确时标注 `[NEEDS CLARIFICATION]`，不得猜测。
- **增量优先**：先写项目级文档（constitution → ARCHITECTURE → TECH → overall-spec → overall-plan），再写模块级文档（spec + plan），最后生成 README 索引。

---

## 七、开发任务规范

### 7.1 确认
- 已安装 **`specs-based-devflow`** 技能。✅

### 7.2 规则
**所有开发任务必须遵循 `specs-based-devflow` 技能定义的完整开发生命周期：**

```
准备阶段 → 规格说明 → 开发 → 代码审查 → 测试 → Bug 修复 → 回归测试
```

- 每个阶段必须**完成并确认后**才能进入下一阶段。
- 每个阶段产出具体工件（spec.md、test-cases.md、DEV_CHECKLIST.md、REVIEW_REPORT.md、TEST_REPORT.md 等）。
- 阶段工件存放于 `<项目根目录>/logs/<YYYYMMDD>-<序号>/`。

### 7.3 代码审查（Code Review）

- 确认已安装 **`requesting-code-review`** 与 **`receiving-code-review`** 技能。✅
- **发起审查**用 `requesting-code-review`；**接收/处理审查反馈**用 `receiving-code-review`。
- 审查时机：子代理驱动开发中每个任务完成后、完成主要功能后、合并主分支前。
- 反馈分级：`Critical`（立即修复）、`Important`（继续开发前修复）、`Minor`（记录后续处理）。
- 接收反馈规则：先验证再实施；**禁止表演性赞同**；允许技术性反驳；遵循 YAGNI；未解决 Critical 前禁止进入测试。

### 7.4 调试（Debugging）

- 确认已安装 **`systematic-debugging`** 技能。✅
- **遇到任何 Bug、测试失败、异常行为时，必须遵循该技能的四阶段调试法**：
  1. **根因调查**：读错误信息、稳定复现、检查最近变更、追踪数据流。
  2. **模式分析**：找范例、对比参考实现、识别差异。
  3. **假设与验证**：单一假设、最小改动验证、一次只改一个变量。
  4. **实施修复**：先写失败测试、实施单一修复、验证、确认无回归。
- **铁律**：严禁在完成根因调查之前提出任何修复方案。
- 连续 3 次修复失败：立即停止、回退到最后正常状态、质疑架构、与用户讨论。

---

## 八、前端界面开发（强制使用 `frontend-design` 技能）

### 8.1 确认
- 已安装 **`frontend-design`** 技能。✅

### 8.2 规则
当任务涉及**前端界面/UI/UX 开发**（构建、重设计页面或组件，做视觉/排版/交互方向决策）时，**必须加载 `frontend-design` 技能**指导界面开发，避免产出模板化、无辨识度的默认样式。

---

## 九、鸿蒙（HarmonyOS）开发规范

### 9.1 确认
- 已安装 **`harmonyos-app-dev`** 与 **`harmonyos-app-testing`** 技能。✅

### 9.2 规则
- **鸿蒙应用开发**（ArkTS/ArkUI/Stage 模型、代码审查、安全审计）→ 只用 `harmonyos-app-dev`。
- **鸿蒙设备/模拟器操作与测试**（hdc、uitest、hilog、安装 .hap、启动、截图）→ 只用 `harmonyos-app-testing`。
- 两者互斥，不得混用。

---

## 十、技能自检与缺失安装

### 10.1 启动时自检
Agent 开始执行任务前，先对照下表自检技能是否满足任务需求：

| 任务类型 | 必备技能 | 安装状态 |
|---------|---------|---------|
| Git 提交 | `git-commit` | ✅ |
| 代码库探索 | `codegraph-cli` | ✅ |
| 产品/需求规划 | `brainstorming` | ✅ |
| 规格说明 | `speckit-specify` / `speckit-plan` / `speckit-tasks` 等 | ✅ |
| 规范文档编写 | `specs-as-built` | ✅ |
| 开发任务 | `specs-based-devflow` | ✅ |
| 代码审查 | `requesting-code-review` / `receiving-code-review` | ✅ |
| 调试 | `systematic-debugging` | ✅ |
| 前端界面开发 | `frontend-design` | ✅ |
| 鸿蒙开发/测试 | `harmonyos-app-dev` / `harmonyos-app-testing` | ✅ |

### 10.2 缺失技能安装脚本
若自检发现任何技能缺失，在本工程根目录执行（`-p` 安装到当前项目，`-y` 跳过确认）：

```bash
npx skills add -p -y https://github.com/dceoy/speckit-agent-skills
npx skills add -p -y https://github.com/obra/superpowers --skill brainstorming
npx skills add -p -y https://github.com/obra/superpowers --skill requesting-code-review
npx skills add -p -y https://github.com/obra/superpowers --skill receiving-code-review
npx skills add -p -y https://github.com/github/awesome-copilot --skill git-commit
npx skills add -p -y https://github.com/anthropics/skills --skill frontend-design
npx skills add -p -y https://github.com/fellow99/fellow99-skills --skill opencode-api
npx skills add -p -y https://github.com/fellow99/fellow99-skills --skill qwen-image
npx skills add -p -y https://github.com/fellow99/fellow99-skills --skill opus-specs-as-built
npx skills add -p -y https://github.com/fellow99/fellow99-skills --skill openrouter-image-generation
npx skills add -p -y https://github.com/fellow99/fellow99-skills --skill specs-based-devflow
npx skills add -p -y https://github.com/fellow99/fellow99-skills --skill codegraph-cli
npx skills add -p -y https://github.com/fellow99/fellow99-skills --skill esp32-image-to-argb
npx skills add -p -y https://github.com/fellow99/fellow99-skills --skill harmonyos-app-dev
npx skills add -p -y https://github.com/fellow99/fellow99-skills --skill harmonyos-app-testing
```

---

## 十一、技能快速索引

| 任务类型 | 必须使用的技能 |
|---------|--------------|
| Git 提交 | `git-commit` |
| 代码库探索 | `codegraph-cli` |
| 产品/需求规划 | `brainstorming` |
| 功能规格生成 | `speckit-specify` |
| 规格澄清 | `speckit-clarify` |
| 技术方案生成 | `speckit-plan` |
| 任务拆解 | `speckit-tasks` |
| 按任务实现 | `speckit-implement` |
| 工件一致性检查 | `speckit-analyze` |
| 质量检查清单 | `speckit-checklist` |
| 逆向规格（源码→文档） | `speckit-baseline` |
| 项目宪法 | `speckit-constitution` |
| 任务→GitHub Issues | `speckit-taskstoissues` |
| 规范文档编写 | `specs-as-built` |
| 开发任务（全流程） | `specs-based-devflow` |
| 发起代码审查 | `requesting-code-review` |
| 接收/处理审查反馈 | `receiving-code-review` |
| 调试 | `systematic-debugging` |
| 前端界面开发 | `frontend-design` |
| 鸿蒙应用开发 | `harmonyos-app-dev` |
| 鸿蒙应用测试/自动化 | `harmonyos-app-testing` |

---

## 十二、违规处理

违反以上任何规范的行为，Agent 必须：
1. 立即停止当前操作。
2. 向用户报告违规内容。
3. 等待用户指示后再继续。

---

> **最后更新**：2026-08-14
> **维护者**：fellow99
