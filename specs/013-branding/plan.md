# 013-branding 技术方案（As-Built）

> 本文档记录 `dsh-desktop` 品牌化的实际实现。
> Module: 013-branding
> 对应规格: [spec.md](./spec.md)
> Last Updated: 2026-11-01

## 1. 技术上下文

### 1.1 运行环境

- Electron 43 + Electron Forge 7 + Vite 7 + TypeScript 5。
- 目标平台：Windows x64、Linux x64、macOS arm64。

### 1.2 依赖与物料

| 项 | 来源 | 用途 |
|----|------|------|
| `resources/icon.ico` | 父工程 `assets/logo.ico` | Windows 打包/安装器图标 |
| `resources/icon.icns` | 父工程 `assets/logo.icns` | macOS 打包图标 |
| `resources/icon.png` | 父工程 `assets/logo.png` | Linux 打包、窗口图标、favicon |
| `resources/tray.png` | 父工程 `assets/logo.png` | 系统托盘图标 |
| `electron` | `43.0.0` | `nativeImage` / `Tray` / `BrowserWindow` |
| `@electron-forge/maker-squirrel` | `^7.11.2` | Windows 安装器 `setupIcon` |

## 2. 宪法合规

| 原则 | 状态 | 说明 |
|------|------|------|
| 零上游改动 | ✅ | 仅壳工程资源与配置 |
| 只写装配代码 | ✅ | 复制物料 + 引用接线 |
| 安全基线 | ✅ | 图标为公开资源，无敏感信息 |
| 源码即真理 | ✅ | 引用点均来自 `forge.config.ts` / `src/main/*` / `index.html` |
| 最小改动 | ✅ | 不改变业务逻辑 |

## 3. 研究结论

- `@electron/packager` 的 `icon` 接受无扩展名路径，按平台自动补 `.ico` / `.icns` / `.png`，因此统一使用 `resources/icon`。
- `packagerConfig.icon` 只把图标嵌入可执行文件，不落盘；窗口/托盘需要在运行时读取，因此通过 `extraResource` 把 `icon.png` 与 `tray.png` 放入 `process.resourcesPath`。
- 打包态与开发态路径不同：窗口/托盘分别用 `app.isPackaged` 分支解析。
- `productName` 带空格会使可执行文件名带空格，`forge.config.ts` 已为 Linux maker 的 `bin` 做处理。

## 4. 数据模型

无数据实体；仅静态资源与配置常量。

| 类型 | 说明 |
|------|------|
| 文件复制 | 父工程 `assets/` → `resources/` |
| 配置 | `forge.config.ts` 的 `icon` / `setupIcon` / `extraResource` |
| 运行时路径 | `app.isPackaged` 分支 |

## 5. 接口契约

### 5.1 构建配置

| 文件 | 配置 |
|------|------|
| `forge.config.ts` | `packagerConfig.icon = 'resources/icon'`；`MakerSquirrel.setupIcon = 'resources/icon.ico'`；`extraResource` 含 `resources/icon.png`、`resources/tray.png` |
| `package.json` | `productName = "DSH Desktop"` |

### 5.2 运行时接口

| 文件 | 行为 |
|------|------|
| `src/main/windows.ts` | `BrowserWindow({ icon: iconPath })`；打包态 `process.resourcesPath/icon.png`，开发态 `resources/icon.png` |
| `src/main/tray.ts` | `nativeImage.createFromPath(trayIconPath)`；失败回退 `nativeImage.createEmpty()` + warning；`tray.setToolTip('DSH Desktop')` |
| `index.html` | `<link rel="icon" type="image/png" href="resources/icon.png" />`；`<title>DSH Desktop</title>` |

## 6. 实现策略

### 6.1 架构模式

“唯一物料源 + 复制分发 + 引用接线”：父工程 `assets/` 是唯一源，壳工程只保存副本并通过固定路径引用。

### 6.2 关键实现

- 打包图标：`packagerConfig.icon` 指向无扩展名 `resources/icon`。
- 安装器图标：`MakerSquirrel.setupIcon` 指向 `resources/icon.ico`。
- 运行时图标：`extraResource` 把 PNG 放到 `process.resourcesPath`，窗口/托盘按打包态分支读取。
- 托盘降级：`icon.isEmpty()` 时记录 warning 并回退空图标。

### 6.3 错误处理

- 托盘图标缺失：warning + 空图标，不阻塞启动。
- 打包图标缺失：Electron Packager 使用默认图标（构建不失败），但验收会失败。

### 6.4 性能

图标为 KB 级，对启动与包体无显著影响。

## 7. 测试考虑

- 打包后检查安装器/可执行文件图标。
- 运行态检查窗口图标、托盘图标、tooltip。
- 打包态检查 `process.resourcesPath` 下资源存在。
- 负向：临时移走 `tray.png`，确认 warning 与启动不阻塞。

## 8. 文件清单

| 文件 | 用途 | 行数（约） |
|------|------|-----------|
| `package.json` | `productName` / 版本 | 40 |
| `forge.config.ts` | 打包图标、安装器图标、extraResource | 170 |
| `src/main/windows.ts` | 窗口图标路径 | 120 |
| `src/main/tray.ts` | 托盘图标、tooltip | 45 |
| `index.html` | favicon、标题 | 45 |
| `resources/icon.ico` / `icon.icns` / `icon.png` / `tray.png` | 品牌物料 | 二进制 |
| `resources/README.md` | 物料说明 | 15 |
