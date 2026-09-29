import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // dsh-dist/ 与 runtime/ 必须排除在 app 源拷贝（→app.asar）之外：二者由下方 extraResource
    // 打入 asar 外的 resources/（host.ts 经 process.resourcesPath 以 file:// 动态 import）。
    // 若不排除，packager 会先把这两个目录（合计 ~1GB / 5.6 万文件）拷进 resources/app 打进
    // app.asar，再经 extraResource 重复拷贝一次 —— asar 对海量小文件的 header 建树会吃掉
    // 数 GB 内存并耗时数十分钟。
    // 注：forge 合并 packageOpts 时 packagerConfig.ignore 会覆盖其内置的 /^\/out\// 默认值，
    // 故在此一并保留 out 目录排除。
    ignore: [/^\/out(\/|$)/, /^\/logs(\/|$)/, /^\/dsh-dist(\/|$)/, /^\/runtime(\/|$)/],
    // 应用图标：@electron/packager 按平台自动补扩展名（win32→icon.ico / darwin→icon.icns / linux→icon.png）
    icon: 'resources/icon',
    // Linux 可执行文件名：maker-rpm/deb 的 bin 默认取 package.json 的 name，而非 productName。
    // productName 带空格时，Electron Packager 会生成 "DSH Desktop" 可执行文件，
    // 与 maker-rpm/deb 期望的 "dsh-desktop" 不匹配（Windows/macOS 用 appName 不受影响）。
    executableName: 'dsh-desktop',
    // dsh 部署产物（dsh-dist/）打进 out/resources/dsh-dist（asar 外，供 host.ts 的
    // ESM 动态 import；含 dsh lib + node_modules + web dist + desktop profile）。
    // 图标：窗口图标（icon.png）与托盘图标（tray.png）需在运行时经 process.resourcesPath 加载，
    // 故一并打入 out/resources/（packagerConfig.icon 只把图标嵌入可执行文件，不落盘）。
    // 注：@electron/packager 18.x 的 extraResource 仅支持字符串（复制到 resources/<basename>）。
    extraResource: ['dsh-dist', 'runtime', 'resources/icon.png', 'resources/tray.png'],
  },
  // 不设置 rebuildConfig：本应用生产依赖（electron-squirrel-startup）无原生模块；dsh-dist
  // 由 extraResource 落在 asar 外、不进入 packager 的 buildPath，故 @electron/rebuild 的扫描
  // 范围仅 resources/app（prune 后无原生模块），无需也无法用 onlyModules 短路（空数组经
  // `|| null` 归一化后不改变 walker 行为）。dsh-dist 内原生模块全部随上游 prebuilt、按目标
  // ABI 直接可用。
  makers: [
    // Windows：Squirrel 安装器（Electron Forge 无官方 NSIS maker）
    new MakerSquirrel({
      // 不签名（本地打包自用）；authors/description 默认取自 package.json
      // Windows 安装器图标（Squirrel 需要 .ico）
      setupIcon: 'resources/icon.ico',
    }),
    // 目录包（免安装，本地自用/调试）
    new MakerZIP({}, ['darwin', 'linux', 'win32']),
    // macOS：DMG（依赖系统 hdiutil，仅 macOS 平台生效；其他平台 make 时自动跳过）
    new MakerDMG({}),
    // Linux：deb / rpm（maker-rpm 需单独安装，已在 devDependencies 中）
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // 主进程 / preload 入口（路径可自定义，匹配 src/main、src/preload 布局）
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Electron Fuses：关闭危险能力（RunAsNode 等）
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
