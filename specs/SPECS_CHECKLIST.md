# SPECS_CHECKLIST.md — 规格检查清单

> dsh-desktop 规范文档完成情况追踪（2026-08-14；2026-11-01 按父工程编号规则整理）。

## 1. 项目级文档

| # | 文档 | 路径 | 状态 |
|---|---|---|---|
| P-01 | 目录结构 | [STRUCTURE.md](./STRUCTURE.md) | ✅ Done |
| P-02 | 技术选型 | [TECH.md](./TECH.md) | ✅ Done |
| P-03 | 整体架构 | [ARCHITECTURE.md](./ARCHITECTURE.md) | ✅ Done |
| P-04 | 宪法原则 | [constitution.md](./constitution.md) | ✅ Done |
| P-05 | 整体规格 | [overall-spec.md](./overall-spec.md) | ✅ Done |
| P-06 | 整体技术方案 | [overall-plan.md](./overall-plan.md) | ✅ Done |
| P-07 | 数据模型 | [overall-data-model.md](./overall-data-model.md) | ✅ Done |
| P-08 | 检查清单 | [SPECS_CHECKLIST.md](./SPECS_CHECKLIST.md) | ✅ Done |
| P-09 | 文档索引 | [README.md](./README.md) | ✅ Done |

> 注：按需求，不写 API.md、overall-api.md、overall-test-cases.md。

## 2. 模块级文档

| # | 模块 | spec.md | plan.md | 状态 |
|---|---|---|---|---|
| M-01 | 012-building-workflow（构建工作流） | [012-building-workflow/spec.md](./012-building-workflow/spec.md) | [012-building-workflow/plan.md](./012-building-workflow/plan.md) | ✅ Done |
| M-02 | 013-branding（品牌化） | [013-branding/spec.md](./013-branding/spec.md) | [013-branding/plan.md](./013-branding/plan.md) | ✅ Done |
| M-03 | 101-runtime-launch-orchestration（应用入口编排） | [101-runtime-launch-orchestration/spec.md](./101-runtime-launch-orchestration/spec.md) | [101-runtime-launch-orchestration/plan.md](./101-runtime-launch-orchestration/plan.md) | ✅ Done |
| M-04 | 103-window-shell（窗口外壳） | [103-window-shell/spec.md](./103-window-shell/spec.md) | [103-window-shell/plan.md](./103-window-shell/plan.md) | ✅ Done |
| M-05 | 105-upstream-adapter-bundle（上游适配层） | [105-upstream-adapter-bundle/spec.md](./105-upstream-adapter-bundle/spec.md) | [105-upstream-adapter-bundle/plan.md](./105-upstream-adapter-bundle/plan.md) | ✅ Done |
| M-06 | 113-tray（系统托盘） | [113-tray/spec.md](./113-tray/spec.md) | [113-tray/plan.md](./113-tray/plan.md) | ✅ Done |
| M-07 | 114-lifecycle-safety（生命周期与安全） | [114-lifecycle-safety/spec.md](./114-lifecycle-safety/spec.md) | [114-lifecycle-safety/plan.md](./114-lifecycle-safety/plan.md) | ✅ Done |
| M-08 | 115-host（Host 宿主） | [115-host/spec.md](./115-host/spec.md) | [115-host/plan.md](./115-host/plan.md) | ✅ Done |
| M-09 | 116-notification（原生通知） | [116-notification/spec.md](./116-notification/spec.md) | [116-notification/plan.md](./116-notification/plan.md) | ✅ Done |
| M-10 | 118-preload-bridge（薄 IPC 桥） | [118-preload-bridge/spec.md](./118-preload-bridge/spec.md) | [118-preload-bridge/plan.md](./118-preload-bridge/plan.md) | ✅ Done |
| M-11 | 201-dsh-market（插件市场） | [201-dsh-market/spec.md](./201-dsh-market/spec.md) | [201-dsh-market/plan.md](./201-dsh-market/plan.md) | ✅ Done |

## 3. 完成度统计

- 项目级：9 / 9 完成
- 模块级：11 / 11 完成（10 个基础/公共模块 + 1 个插件模块）
