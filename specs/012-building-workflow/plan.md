# 012-building-workflow 技术方案（As-Built）

> 本文档记录 `dsh-desktop` 构建工作流的实际实现。
> Module: 012-building-workflow
> 对应规格: [spec.md](./spec.md)
> Last Updated: 2026-11-01

## 1. 技术上下文

### 1.1 运行环境

- GitHub Actions：`windows-latest` / `ubuntu-latest` / `macos-latest`。
- Node：22（`actions/setup-node@v7`，npm 缓存）。
- 包管理器：npm（壳工程）+ corepack/pnpm（dsh 构建内部）。
- 构建工具：Electron Forge 7 + Vite 7 + TypeScript 5。

### 1.2 关键依赖

| 依赖 | 版本/来源 | 用途 |
|------|-----------|------|
| `actions/checkout` | v7 | 检出壳工程 |
| `actions/setup-node` | v7 | Node 22 + npm cache |
| `actions/upload-artifact` | v7 | 上传三平台制品 |
| `actions/download-artifact` | v8 | 汇总 Release 制品 |
| `softprops/action-gh-release` | v3 | 创建 GitHub Release |
| dsh | `dsh-v0.2.1-rc.2` | 同级源码 |
| dsh-market | `v1.26.0` | 同级源码 |

## 2. 宪法合规

| 原则 | 状态 | 说明 |
|------|------|------|
| 零上游改动 | ✅ | 仅 checkout 上游并应用既有 patch |
| 同源数据面 | ✅ | 构建流程不改变运行时数据面 |
| 安全基线 | ✅ | 仅使用 `GITHUB_TOKEN`，无签名密钥 |
| 源码即真理 | ✅ | 版本与步骤均来自 `.github/workflows/*.yml` |
| 最小改动 | ✅ | 工作流只做构建/发布编排 |

## 3. 研究结论

- dsh 通过 `../deepseek-harness` 同级源码引用，`actions/checkout` 的 `path` 不能越出 `$GITHUB_WORKSPACE`，因此使用 `git clone` 到同级目录。
- dsh 构建脚本内部有嵌套 `pnpm` 调用，必须 `corepack enable` 生成 shim。
- Linux 的 `maker-deb` 需要 `fakeroot` + `dpkg`，`maker-rpm` 需要 `rpmbuild`，CI 显式安装。
- 上传制品后执行位可能丢失，Release 作业用 `chmod -R +x` 恢复。

## 4. 数据模型

无持久化数据；工作流状态由 GitHub Actions 管理。

| 字段 | 说明 |
|------|------|
| `matrix.os` | 三平台矩阵 |
| `DSH_REF` | dsh checkout ref |
| `DSH_MARKET_REF` | dsh-market checkout ref |
| `version` | 手动触发的 release tag |

## 5. 接口契约

### 5.1 触发接口

| 工作流 | 触发 | 输入 |
|--------|------|------|
| `ci.yml` | `push` main、`pull_request` | 无 |
| `release.yml` | `push` tags `v*`、`workflow_dispatch` | `dsh_ref`、`dsh_market_ref`、`version` |

### 5.2 制品契约

- CI：artifact 名 `dist-<os>`，路径 `out/make/`。
- Release：附件匹配 `**/*.exe`、`**/*.nupkg`、`**/*.deb`、`**/*.rpm`、`**/*.dmg`、`**/*.zip`。

## 6. 实现策略

### 6.1 架构模式

两段式：`ci.yml`（验证）与 `release.yml`（构建 + 发布）。两者共享相同的三平台构建步骤，差异仅在触发方式、上游 ref 可覆盖与 Release 作业。

### 6.2 关键步骤

1. checkout 壳工程。
2. `git clone` dsh / dsh-market 到同级目录。
3. setup-node 22、`corepack enable`。
4. Linux 安装 `fakeroot`、`rpm`。
5. `npm ci` → `npm run build:dsh` → `npm run make`。
6. 上传/汇总制品，创建 Release。

### 6.3 错误处理

- 任一步骤失败即 job 失败；矩阵 `fail-fast: false` 保留其他平台结果。
- `if-no-files-found: error` 防止空制品被当成成功。
- Release 的 `fail_on_unmatched_files: false` 允许部分平台产物缺失时仍发布，但构建 job 必须先成功。

### 6.4 性能

- npm 缓存 + 三平台并行。
- `concurrency` 取消同一 ref 的旧 CI 运行，节省额度。

## 7. 测试考虑

- 静态校验：YAML 语法、触发条件、矩阵、版本 pin。
- 干跑：`workflow_dispatch` 手动触发 Release，确认制品与 Release 生成。
- 回归：升级 dsh tag 后重跑 CI，确认 patch 与构建链同步。

## 8. 文件清单

| 文件 | 用途 | 行数（约） |
|------|------|-----------|
| `.github/workflows/ci.yml` | 三平台 CI | 70 |
| `.github/workflows/release.yml` | 三平台发布 + Release | 110 |
| `scripts/build-dsh.mjs` | dsh patch + 构建 + market 构建 | — |
| `scripts/collect-dsh.mjs` | dsh 产物物化 | — |
| `scripts/fetch-runtime.mjs` | 便携 Node/pnpm 运行时准备 | — |
