# 构建工作流 功能规格

> Module: 012-building-workflow
> Status: Implemented（as-built）
> Last Updated: 2026-11-01

## 1. 模块概述

### 1.1 目的（Why this module exists）

本模块定义 `dsh-desktop` 在 GitHub Actions 上的构建工作流：持续集成（CI）验证主分支与 Pull Request 可构建，发布工作流（Release）在版本 tag 上产出 Windows / Linux / macOS 三平台安装产物并上传到 GitHub Release。

### 1.2 解决的问题

- 桌面壳依赖同级 `deepseek-harness` 与 `dsh-market` 源码，构建链长（patch → dsh 构建 → 物料化 → Electron 打包），需要可重复的云端流水线。
- 本地 `npm run make` 无法覆盖三平台；发布产物需要统一的 tag 触发与制品归档。
- dsh / dsh-market 版本必须与 shell 的 patch 目录、运行时版本成对锁定，避免“本地能构建、CI 失败”。

### 1.3 范围

**包含：**

- 主分支 push / Pull Request 触发的三平台 CI。
- `v*` tag 或手动 `workflow_dispatch` 触发的发布构建。
- 同级源码 checkout、Node/corepack 准备、Linux 打包依赖安装、dsh 构建、Electron Forge `make`、制品上传。
- Release 作业：下载三平台制品、恢复执行位、创建 GitHub Release。

**不包含：**

- 代码签名、公证（notarization）、自动更新、商店分发（README 已声明未实现）。
- HarmonyOS / Android 构建（分别见 `dsh-desktop-hos`、`dsh-desktop-ark`、`dsh-desktop-android`；鸿蒙工程无本模块）。
- 上游 dsh / dsh-market / Electron 自身的构建流水线。

## 2. 用户故事

- 作为维护者，我希望每次 push/PR 都自动验证三平台可构建，避免合并后才发现跨平台问题。
- 作为发布负责人，我希望打一个 `v*` tag 就得到三平台安装包，并自动生成 GitHub Release。
- 作为构建排障者，我希望流水线显式锁定 dsh、dsh-market 与 Node 版本，失败时能定位是上游漂移还是壳代码问题。

## 3. 功能需求

### 3.1 持续集成（CI）

- FR-012-001：CI MUST 在 `push` 到 `main` 与 `pull_request` 时触发，并设置并发组取消同一 ref 的旧运行。
- FR-012-002：CI MUST 使用 `windows-latest` / `ubuntu-latest` / `macos-latest` 三平台矩阵，且 `fail-fast: false`。
- FR-012-003：CI MUST 将 `deepseek-harness` 以同级目录 `../deepseek-harness` checkout（不使用 submodule），并锁定 dsh tag。
- FR-012-004：CI MUST 将 `dsh-market` 以同级目录 `../dsh-market` checkout，并锁定 market tag。
- FR-012-005：CI MUST 准备 Node 22、启用 corepack，并在 Linux 安装 `fakeroot` 与 `rpm` 打包依赖。
- FR-012-006：CI MUST 执行 `npm ci`、`npm run build:dsh`、`npm run make`，并上传 `out/make/` 制品；无制品时 MUST 失败。

### 3.2 发布（Release）

- FR-012-007：Release MUST 由 `v*` tag push 或手动 `workflow_dispatch` 触发；手动触发 MUST 要求填写 release tag。
- FR-012-008：Release MUST 允许手动覆盖 dsh ref 与 dsh-market ref，缺省使用与 shell 锁定的版本。
- FR-012-009：Release 构建 MUST 复用与 CI 相同的三平台矩阵、同级源码 checkout、依赖安装与 `npm run make` 步骤。
- FR-012-010：Release 作业 MUST 汇总三平台制品（`.exe` / `.nupkg` / `.deb` / `.rpm` / `.dmg` / `.zip`），恢复可执行位后创建 GitHub Release。
- FR-012-011：Release MUST 使用 `GITHUB_TOKEN` 的 `contents: write` 权限，且不依赖任何签名密钥。
- FR-012-012：工作流 MUST 显式声明 dsh / dsh-market 版本；版本升级时 MUST 与 `patches/<dsh-tag>/`、`scripts/build-dsh.mjs` 的 pin 同步。

## 4. 关键实体

| 实体 | 说明 | 关键属性 |
|------|------|----------|
| Workflow Run | 一次 CI/Release 运行 | 触发事件、矩阵 OS、状态、制品 |
| 上游锁定 | 同级源码版本 | dsh tag、dsh-market tag |
| 制品 | `out/make/` 下的安装包 | 平台、格式、文件名 |
| Release | GitHub Release | tag、附件、release notes |

## 5. 验收场景

### 场景：主分支 CI

- Given 代码已 push 到 `main`
- When GitHub Actions 运行 CI
- Then 三平台矩阵均完成 `npm run make`，并上传 `dist-<os>` 制品

### 场景：发布 tag

- Given 维护者推送 `v0.2.1` tag
- When Release 工作流完成
- Then GitHub Release `v0.2.1` 含三平台安装包，且 release notes 自动生成

### 场景：上游版本漂移

- Given dsh tag 与 patch 目录不一致
- When CI 执行 `npm run build:dsh`
- Then 构建失败并指出 patch 应用/版本 pin 问题

## 6. 非功能需求

- **可重复性**：同级源码与 Node 版本显式锁定；不使用浮动 `latest`。
- **成本**：三平台矩阵并行，`fail-fast: false` 保留完整失败信息。
- **安全**：仅使用 `GITHUB_TOKEN`；不注入签名材料；制品为未签名产物。
- **可维护性**：dsh / dsh-market 版本升级点集中在 workflow 与 `scripts/build-dsh.mjs`。

## 7. 假设与约束

- 假设 GitHub Actions 可访问 GitHub 上的 dsh / dsh-market 仓库。
- 约束：桌面安装包未签名、未公证；不满足商店分发要求。
- 约束：CI 不运行完整 E2E；运行时验证由本地 `npm start` / 手工回归完成。

## 8. 依赖

- 上游：`deepseek-harness`（dsh）、`dsh-market`。
- 构建：Node 22、corepack/pnpm、Electron Forge、平台打包工具。
- 下游：GitHub Release 下载页与产品官网版本展示。
