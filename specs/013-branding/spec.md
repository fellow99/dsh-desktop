# 品牌化 功能规格

> Module: 013-branding
> Status: Implemented（as-built；打包/运行态接线；截图证据为历史记录）
> Last Updated: 2026-11-01

## 1. 模块概述

### 1.1 目的（Why this module exists）

本模块定义 `dsh-desktop` 的产品身份：应用名、安装包/可执行文件图标、窗口图标、系统托盘图标与兜底页 favicon，使桌面端在 Windows / Linux / macOS 上呈现统一的 “DSH Desktop” 品牌，而不是 Electron 默认图标或上游名称。

### 1.2 解决的问题

- 未接入物料时，Electron 打包产物使用默认 Electron 图标，托盘为空占位。
- 应用名、窗口标题、托盘 tooltip 若不统一，用户会看到 “Electron” / “deepseek-harness” 等不一致身份。
- 品牌物料需要单一来源，避免各平台各自维护一套图标。

### 1.3 范围

**包含：**

- 应用名 `DSH Desktop`（`package.json` 的 `productName`、页面标题、托盘 tooltip）。
- 打包图标：Windows `.ico`、macOS `.icns`、Linux `.png`。
- 运行时图标：窗口图标 `icon.png`、托盘图标 `tray.png`。
- 兜底页 favicon。
- 物料来源：父工程 `assets/`（`logo.ico` / `logo.icns` / `logo.png`）复制到 `resources/`。

**不包含：**

- Web UI 内部的侧栏/hero 品牌位（桌面端直接复用上游 UI，未做 seam 品牌插件；品牌位由上游显示）。
- 安装包签名、公证、商店 listing 文案。
- 托盘菜单文案的本地化（当前为中文）。

## 2. 用户故事

- 作为用户，我希望安装包、可执行文件、窗口与托盘都显示统一的 DSH 产品图标。
- 作为用户，我希望应用名、窗口标题与托盘提示都是 “DSH Desktop”，而不是 Electron 或上游名称。
- 作为维护者，我希望品牌物料只有一个来源（父工程 `assets/`），升级时按固定路径重新复制即可。

## 3. 功能需求

### 3.1 应用身份

- FR-013-001：`package.json` 的 `productName` MUST 为 `DSH Desktop`。
- FR-013-002：应用窗口标题 MUST 为 `DSH Desktop`；兜底页标题与页面内标题 MUST 一致。
- FR-013-003：系统托盘 tooltip MUST 为 `DSH Desktop`。

### 3.2 图标

- FR-013-004：`resources/` MUST 提供 `icon.ico`（Windows）、`icon.icns`（macOS）、`icon.png`（Linux/窗口/favicon）、`tray.png`（托盘）。
- FR-013-005：Electron Packager MUST 通过 `packagerConfig.icon = 'resources/icon'` 按平台自动选择 `.ico` / `.icns` / `.png`。
- FR-013-006：Windows 安装器 MUST 通过 `MakerSquirrel.setupIcon = 'resources/icon.ico'` 使用产品图标。
- FR-013-007：主窗口 MUST 通过 `BrowserWindow.icon` 使用 `resources/icon.png`（开发态与打包态路径分别解析）。
- FR-013-008：托盘 MUST 通过 `nativeImage.createFromPath` 加载 `resources/tray.png`；加载失败时 MAY 回退空图标并记录 warning，不得阻塞启动。
- FR-013-009：打包配置 MUST 将 `resources/icon.png` 与 `resources/tray.png` 放入 `extraResource`，保证运行时 `process.resourcesPath` 可解析。
- FR-013-010：兜底页 `index.html` MUST 通过 `<link rel="icon">` 引用 `resources/icon.png`。

### 3.3 物料来源与分发

- FR-013-011：品牌物料 MUST 以父工程 `assets/` 为唯一来源，以复制方式分发到 `dsh-desktop/resources/`，不修改物料源。
- FR-013-012：物料更新 MUST 按相同文件名覆盖，不改变代码引用路径。

## 4. 关键实体

| 实体 | 说明 | 关键属性 |
|------|------|----------|
| 应用身份 | 产品名 | `productName`、窗口标题、托盘 tooltip |
| 打包图标 | 安装包/可执行文件图标 | `icon.ico` / `icon.icns` / `icon.png` |
| 运行时图标 | 窗口/托盘 | `icon.png` / `tray.png` |
| 物料源 | 父工程 `assets/` | `logo.ico` / `logo.icns` / `logo.png` |

## 5. 验收场景

### 场景：Windows 安装包图标

- Given `npm run make` 完成
- When 查看安装器与安装后的可执行文件
- Then 显示 DSH 产品图标（非 Electron 默认图标）

### 场景：窗口与托盘图标

- Given 应用运行
- When 观察主窗口标题栏/任务栏与系统托盘
- Then 窗口图标与托盘图标均为产品图标，tooltip 为 `DSH Desktop`

### 场景：打包态资源解析

- Given 应用以打包产物运行
- When 主窗口与托盘初始化
- Then `process.resourcesPath` 下能解析 `icon.png` 与 `tray.png`，无图标加载 warning

## 6. 非功能需求

- **体积**：图标为 KB 级，不影响安装包体积。
- **兼容性**：同时覆盖 Windows `.ico`、macOS `.icns`、Linux `.png`。
- **可维护性**：物料源唯一；代码引用路径固定。
- **降级**：托盘图标加载失败只记录 warning 并回退空图标，不阻塞应用启动。

## 7. 假设与约束

- 假设父工程 `assets/` 中的 logo 物料满足各平台尺寸/格式要求。
- 约束：不改动上游 dsh / dsh-market / Electron 源码。
- 约束：不实现 Web UI 内部品牌位替换（与 Electron-on-HarmonyOS / Android 的 seam 插件不同）。

## 8. 依赖

- 上游物料：父工程 `assets/`。
- 构建：Electron Forge / Packager / MakerSquirrel。
- 运行时：Electron `nativeImage`、`Tray`、`BrowserWindow`。
