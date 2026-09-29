import { app } from 'electron';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';

/**
 * dsh Host 宿主：在主进程内 runProfile('desktop') 挂起 dsh Host（含 webserver），
 * 渲染进程同源加载 localhost（产品概念设计第 7、9 节）。
 *
 * 参考（源码级核实，2026-08-14）：
 * - runProfile：deepseek-harness/apps/cli/src/profile-boot.ts:207
 *   `runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }>`
 * - RunProfileOptions：`{ environment, profile, patchFiles, args }`（profile-boot.ts:174-183）
 * - webserver：`ctx.webServer.port` —— config.port 传 0 时返回 OS 分配端口
 *   （deepseek-harness/packages/host/webserver/src/index.ts:78-81）
 * - profile 目录：`$DSH_HOME/profiles/<name>`（dsh-app-boot/src/profile.ts:104-111）
 * - `$DSH_HOME`：环境变量 `DSH_HOME`，默认 `~/.dsh`（dsh-home-paths）
 */

// dsh 部署产物位置：
// - 开发：与 desktop 同级目录的 deepseek-harness 源码（workspace 链接解析）
// - 打包：out/resources/dsh-dist（collect-dsh 的 pnpm deploy 物化产物，extraResource 打入）
const DSH_ROOT = app.isPackaged
  ? join(process.resourcesPath, 'dsh-dist')
  : resolve(__dirname, '../../../deepseek-harness');
// profile-boot 产物目录（apps/cli 的 lib；deploy 物化后即 dsh-dist/lib）
const DSH_CLI_LIB = app.isPackaged
  ? join(DSH_ROOT, 'lib')
  : join(DSH_ROOT, 'apps/cli/lib');
// loadLayeredEnv（dsh-app-boot 的 lib）
const DSH_APP_BOOT_LIB = app.isPackaged
  ? join(DSH_ROOT, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')
  : join(DSH_ROOT, 'packages/boot/app-boot/lib/index.js');
// desktop 工程自带的 desktop profile（collect 时物化进 dsh-dist/profiles/desktop）
const DESKTOP_PROFILE_SRC = app.isPackaged
  ? join(DSH_ROOT, 'profiles/desktop')
  : resolve(__dirname, '../../profiles/desktop');

/** dsh Cordis Context 的最小接口（仅暴露桌面侧订阅事件与鉴权 URL 所需的字段） */
export interface HostContext {
  webServer: { port: number };
  /**
   * 浏览器会话鉴权（dsh v0.1.2-rc.1 起）：Host 对所有 /api 与首页请求强制
   * 启动令牌鉴权，只有携带本进程 launch token 的根 URL 才能换取签名 cookie。
   * 渲染进程必须加载 authenticatedUrl 返回的 `/?token=...`，而非裸 `/`。
   */
  connection: {
    /** 把普通根 URL 换成携带本进程 launch token 的鉴权根 URL。 */
    authenticatedUrl: (baseUrl: string) => string;
  };
  /** 订阅 host 事件（cordis ctx.on），供托盘/通知用 */
  on(event: string, listener: (...args: unknown[]) => void): void;
}

/** dsh Host 句柄 */
export interface HostHandle {
  ctx: HostContext;
  /** 优雅关闭：dispose 插件树（ProcessShutdown.shutdown） */
  shutdown: (code?: number) => Promise<void> | void;
  /** webserver 实际绑定端口（--port 0 → OS 分配） */
  port: number;
  /**
   * 同源鉴权加载 URL：`http://127.0.0.1:<port>/?token=<launchToken>`。
   * 首次加载时 dsh 用该 token 换取签名 cookie 并 303 重定向到干净的 `/`，
   * 之后同 authority 的渲染进程请求（含 /api 与 WebSocket）即被放行。
   */
  url: string;
}

/**
 * 在 dsh CLI lib 目录中定位 profile-boot 的薄入口（re-export runProfile）。
 * tsdown 构建产物文件名带内容 hash（如 profile-boot-BnJoK_kl.js），
 * 不硬编码 hash，而是扫描目录按「薄入口仅 2 行 re-export」的特征定位。
 */
function findProfileBootEntry(): string | null {
  try {
    const candidates: { path: string; mtime: number }[] = [];
    for (const file of readdirSync(DSH_CLI_LIB)) {
      // rc.2 起 tsdown 命名变化：薄入口为 profile-boot.js（无 hash），实现 chunk 为
      // profile-boot-<hash>.js；旧版本二者相反。两种名称都纳入扫描。
      if (!/^profile-boot(-.+)?\.js$/.test(file)) continue;
      const fullPath = join(DSH_CLI_LIB, file);
      const content = readFileSync(fullPath, 'utf8');
      // 薄入口：仅从同级 chunk re-export（含 runProfile），体积小。tsdown 产物可能为
      // 多导出且按字母排序（如 export { A, runProfile, Z }），用正则识别导出列表。
      const reExportsRunProfile = /export\s*\{[^}]*\brunProfile\b[^}]*\}/.test(content);
      if (reExportsRunProfile && content.length < 600) {
        candidates.push({ path: fullPath, mtime: statSync(fullPath).mtimeMs });
      }
    }
    // tsdown 每次构建生成新 hash 产物、旧产物残留，取 mtime 最新的薄入口
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0]?.path ?? null;
  } catch {
    // dsh 未构建，降级
  }
  return null;
}

/**
 * 将 desktop profile 安装到 `$DSH_HOME/profiles/desktop`（幂等）。
 * desktop 的 profile 声明 `dsh.profile.bundles = [dsh-base, dsh-web-app]`（web 组合，
 * 微调 printUrl），而 dsh 对未知 profile 的默认初始化只有 `dsh-base`（无 web-app），
 * 故必须显式放置 desktop 工程自带的 profile。
 *
 * 合并策略（不能整目录覆盖）：用户通过市场安装插件后，dsh 会把插件追加进该 profile 的
 * package.json（dependencies + bundles）。整目录覆盖会抹掉用户安装的插件。因此：
 *  - dest 不存在 → 复制种子；
 *  - dest 已存在 → 仅把缺失的「种子依赖」和「种子 bundle」合并进 dest 的 package.json，
 *    保留用户追加的插件；种子的其他文件（cordis.patch.yml 等）照常补齐。
 */
function ensureDesktopProfile(home: string): void {
  const dest = join(home, 'profiles', 'desktop');
  const srcPkg = join(DESKTOP_PROFILE_SRC, 'package.json');
  if (!existsSync(srcPkg)) return;
  mkdirSync(dest, { recursive: true });

  const destPkg = join(dest, 'package.json');
  if (!existsSync(destPkg)) {
    cpSync(DESKTOP_PROFILE_SRC, dest, { recursive: true });
    return;
  }

  // 合并 package.json：补齐缺失的种子依赖与 bundle，不动用户已追加的内容。
  try {
    const seed = JSON.parse(readFileSync(srcPkg, 'utf8')) as {
      dependencies?: Record<string, string>;
      dsh?: { profile?: { bundles?: string[] } };
    };
    const cur = JSON.parse(readFileSync(destPkg, 'utf8')) as {
      dependencies?: Record<string, string>;
      dsh?: { profile?: { bundles?: string[] } };
    };
    let changed = false;

    cur.dependencies ??= {};
    for (const [name, spec] of Object.entries(seed.dependencies ?? {})) {
      if (!(name in cur.dependencies)) {
        cur.dependencies[name] = spec;
        changed = true;
      }
    }

    cur.dsh ??= {};
    cur.dsh.profile ??= {};
    const curBundles = cur.dsh.profile.bundles ?? [];
    for (const b of seed.dsh?.profile?.bundles ?? []) {
      if (!curBundles.includes(b)) {
        curBundles.push(b);
        changed = true;
      }
    }
    cur.dsh.profile.bundles = curBundles;

    if (changed) writeFileSync(destPkg, JSON.stringify(cur, null, 2) + '\n');
  } catch {
    // 解析失败保持现状，避免破坏用户已修改的 profile
  }

  // 种子文件同步：产品自有的 cordis.patch.yml 必须随版本更新强制覆盖（它只承载壳的
  // 组合决策，如 openBrowser:false，不含用户数据）；早期版本漏写 openBrowser 会导致
  // dsh web 去 spawn 系统浏览器、在 Electron 下拉起异常第二实例使整个进程退出，必须能
  // 在升级后自愈。其余文件保持「缺失才补齐」，绝不覆盖用户改动。
  // package.json 不在此列（用户经市场安装的插件依赖在其中，已在上面做合并）。
  const PRODUCT_OWNED_PROFILE_FILES = new Set(['cordis.patch.yml']);
  for (const name of readdirSync(DESKTOP_PROFILE_SRC)) {
    if (name === 'package.json') continue;
    const destFile = join(dest, name);
    if (PRODUCT_OWNED_PROFILE_FILES.has(name) || !existsSync(destFile)) {
      cpSync(join(DESKTOP_PROFILE_SRC, name), destFile, { recursive: true });
    }
  }
}

/** dsh runProfile 的最小签名（动态 import 产物无类型，此处收窄以保持类型安全） */
interface DshRunProfile {
  (options: {
    environment: unknown;
    profile: string;
    patchFiles: readonly string[];
    args: readonly string[];
  }): Promise<{
    ctx: {
      webServer: { port: number };
      connection: { authenticatedUrl: (baseUrl: string) => string };
      on: HostContext['on'];
    };
    shutdown: { shutdown: (code?: number) => void | Promise<void> };
  }>;
}

/**
 * 将 dsh 的 workspace 包链接到根 node_modules，使 loader 的默认 ESM import 可解析。
 *
 * 背景：dsh 的 loader（cordis-plugin-loader）通过 node-addon-require-builtin 原生模块
 * 获取 Node 内部 ESM loader（internal import，锚定 profile 目录解析插件）。该原生模块
 * 依赖 Electron V8 缺失的 GetAlignedPointerFromEmbedderData 符号（Electron 的 V8 为
 * -electron 分支），在 Electron 下加载失败，internal 失效，loader 回退到默认 ESM import
 * （从 vendor/loader/lib 向上解析）。pnpm 默认把 workspace 包链接在消费方 node_modules
 * （apps/cli/node_modules），根 node_modules 仅含根 manifest 直接依赖，故默认 import
 * 找不到插件。此处扫描 dsh 的全部 workspace 包源码目录（packages、vendor、apps），
 * 以 junction 链接到根 node_modules/@deepseek-ai/，使其可解析（包的 exports 指向编译产物 lib）。
 */
function ensureWorkspaceLinks(): void {
  const dest = join(DSH_ROOT, 'node_modules/@deepseek-ai');
  mkdirSync(dest, { recursive: true });
  for (const root of ['packages', 'vendor', 'apps']) {
    const rootDir = join(DSH_ROOT, root);
    if (!existsSync(rootDir)) continue;
    for (const cat of readdirSync(rootDir)) {
      const catDir = join(rootDir, cat);
      if (!existsSync(join(catDir, 'package.json'))) {
        // packages 为两级（packages/分类/包），vendor、apps 为一级
        if (!existsSync(catDir)) continue;
        try {
          for (const pkg of readdirSync(catDir)) {
            linkWorkspacePackage(join(catDir, pkg), dest);
          }
        } catch {
          // 非目录，跳过
        }
      } else {
        linkWorkspacePackage(catDir, dest);
      }
    }
  }
}

/** 若目录是 @deepseek-ai 包，且根 node_modules 无对应链接，则以 junction 链接。 */
function linkWorkspacePackage(pkgDir: string, dest: string): void {
  const pkgJson = join(pkgDir, 'package.json');
  if (!existsSync(pkgJson)) return;
  try {
    const name = JSON.parse(readFileSync(pkgJson, 'utf8')).name as string | undefined;
    if (!name || !name.startsWith('@deepseek-ai/')) return;
    const shortName = name.slice('@deepseek-ai/'.length);
    const destPath = join(dest, shortName);
    if (existsSync(destPath)) return;
    symlinkSync(pkgDir, destPath, 'junction');
  } catch {
    // 解析失败或非 @deepseek-ai 包，跳过
  }
}

/** 递归复制 dshmarket 的运行时依赖（其 dependencies 字段 + 传递依赖）到物化目录。
 *  npm 扁平布局下传递依赖也位于顶层，逐包读 dependencies 遍历。仅复制生产依赖，
 *  避免 devDeps（react/vitest 等）的体积膨胀与 @deepseek-ai 副本的版本错配。 */
function copyMarketRuntimeDeps(srcNm: string, destNm: string, marketRoot: string): void {
  let queue: string[];
  try {
    const marketPkg = JSON.parse(readFileSync(join(marketRoot, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    queue = Object.keys(marketPkg.dependencies ?? {});
  } catch {
    return;
  }
  const seen = new Set<string>();
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name) || name.startsWith('@deepseek-ai/')) continue;
    seen.add(name);
    const srcPkg = join(srcNm, name);
    const destPkg = join(destNm, name);
    if (!existsSync(join(srcPkg, 'package.json')) || existsSync(join(destPkg, 'package.json'))) continue;
    cpSync(srcPkg, destPkg, { recursive: true, dereference: true });
    try {
      const deps = (JSON.parse(readFileSync(join(srcPkg, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }).dependencies ?? {};
      for (const dep of Object.keys(deps)) queue.push(dep);
    } catch {
      // 无法解析依赖清单，跳过其传递依赖
    }
  }
}

/** 将 dsh-market（插件市场，非 scoped 包）构建产物物化到 dsh 根 node_modules，使 loader 默认 ESM import 可解析。
 *  仅复制 lib/、client/、cordis.patch.yml、package.json + 运行时依赖；dshmarket 的 @deepseek-ai 依赖
 *  从宿主（dsh 根 node_modules，经 ensureWorkspaceLinks）解析，避免其 devDeps 里的 @deepseek-ai 副本版本错配。
 *  与 collect-dsh.mjs 的打包物化（dsh-dist/node_modules/dshmarket）对齐。 */
function ensureDshMarketMaterialized(): void {
  const src = resolve(__dirname, '../../../dsh-market');
  const dest = join(DSH_ROOT, 'node_modules', 'dshmarket');
  if (!existsSync(join(src, 'package.json'))) return;
  // 已物化且未过期（src lib 未重新构建）则跳过；否则清理重物化，避免陈旧产物（开发者重建 dsh-market 后）。
  const srcLib = join(src, 'lib', 'index.js');
  const destLib = join(dest, 'lib', 'index.js');
  if (existsSync(destLib) && existsSync(srcLib) && statSync(srcLib).mtimeMs <= statSync(destLib).mtimeMs) return;
  try {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    for (const entry of ['package.json', 'cordis.patch.yml', 'lib', 'client']) {
      const s = join(src, entry);
      if (existsSync(s)) cpSync(s, join(dest, entry), { recursive: true, dereference: true });
    }
    // 复制 dshmarket 的运行时依赖（undici、js-yaml 等，含传递依赖）；@deepseek-ai scope 从宿主解析。
    const srcNm = join(src, 'node_modules');
    if (existsSync(srcNm)) {
      const destNm = join(dest, 'node_modules');
      mkdirSync(destNm, { recursive: true });
      copyMarketRuntimeDeps(srcNm, destNm, src);
    }
    console.log('[dsh-desktop] 已物化 dshmarket → dsh 根 node_modules');
  } catch {
    // 物化失败降级：市场不可解析时随 Host 启动不加载，不阻塞
  }
}

/** 将 dshmarket 链接到 $DSH_HOME/profiles/node_modules，使 dsh-client-modules（baseUrl = profile 目录）
 *  的 client 扫描能解析 dshmarket 的 dsh.client 声明，从而服务 /plugins/dshmarket/client.js。
 *  loader 的 bundle 解析走 install anchor（DSH_ROOT/node_modules），而 client 扫描走 profile 目录，
 *  两条路径不同，故需两处皆可解析。开发/打包均需（打包态 src 为 dsh-dist/node_modules/dshmarket）。 */
function ensureDshMarketProfileLink(): void {
  const src = app.isPackaged
    ? join(process.resourcesPath, 'dsh-dist', 'node_modules', 'dshmarket')
    : join(DSH_ROOT, 'node_modules', 'dshmarket');
  if (!existsSync(join(src, 'package.json'))) return;
  const home = process.env.DSH_HOME;
  if (!home) return;
  const dest = join(home, 'profiles', 'node_modules', 'dshmarket');
  if (existsSync(dest)) return;
  try {
    mkdirSync(join(home, 'profiles', 'node_modules'), { recursive: true });
    symlinkSync(src, dest, 'junction');
    console.log('[dsh-desktop] 已链接 dshmarket → profiles/node_modules');
  } catch {
    // 链接失败降级：client 扫描不到则市场 UI 不注入，不阻塞 Host
  }
}

/**
 * 将 desktop profile 中通过市场安装的插件 junction 到 dsh 根 node_modules，使 loader 能裸名解析。
 *
 * 背景：用户安装的插件落在 `$DSH_HOME/profiles/desktop/node_modules/<plugin>`（pnpm 独立目录树）。
 * `cordis-plugin-loader` 位于 `<dsh根>/node_modules/@deepseek-ai/`，用裸 `import('<plugin>')` 加载
 * bundle 时 Node 沿 dsh 根目录树向上查找 node_modules，到不了独立的 profile 目录树，导致
 * ERR_MODULE_NOT_FOUND、Host 启动失败。dsh 自带的 healProfilesModuleFallback 仅链接 install
 * anchor 依赖闭包内的包，不含用户新装的插件，故此处补两环：
 *  1. 把 profile node_modules 顶层包（直接依赖）链接到 dsh 根 node_modules；
 *  2. 把 pnpm 虚拟存储 `profile/node_modules/.pnpm/node_modules/` 下的全部包（含传递依赖）
 *     也链接过去 —— 聚合型插件（如 dsh-web-ui-all）会把十几个传递依赖声明为 loader entry，
 *     仅链接顶层直接依赖会导致这些 entry ERR_MODULE_NOT_FOUND。
 * 均为 nearest-wins（已存在的 dshmarket/@deepseek-ai/dsh-dist 自带依赖不覆盖）。
 * 必须在 runProfile 之前执行（healProfilesModuleFallback 之后或之前均可，链接幂等）。
 */
function ensureProfilePluginLinks(): void {
  const home = process.env.DSH_HOME;
  if (!home) return;
  const rootNm = join(DSH_ROOT, 'node_modules');
  mkdirSync(rootNm, { recursive: true });
  // 清理悬空 junction：插件被市场卸载后 pnpm 可能删除整个 profile node_modules，
  // 但上一轮启动建到 dsh 根 node_modules 的 junction 残留（指向已不存在的目标）。
  // 用 readlinkSync 识别链接（不依赖 isSymbolicLink 在 Windows junction 上的跨运行时差异），
  // 再用 existsSync 跟随判断目标是否存活；pnpm 部署的真实文件/目录 readlinkSync 抛 EINVAL，不会被误删。
  const isDanglingLink = (p: string): boolean => {
    try { readlinkSync(p); } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EINVAL') return false; // 非链接（真实文件/目录）
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;  // 父路径缺失
      return false;
    }
    return !existsSync(p); // 是链接：目标不存在 => 悬空
  };
  const pruneDangling = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      let ls;
      try { ls = lstatSync(p); } catch { continue; }
      if (ls.isSymbolicLink() || isDanglingLink(p)) {
        if (isDanglingLink(p)) {
          // rmSync({force}) 在 Windows 悬空 junction 上会跟随链接、报 "Path is a directory"；
          // unlinkSync 删除链接本身（不跟随目标）。Windows 目录 junction 在部分 Node 版本上
          // unlink 返回 EPERM/EISDIR，此时 rmdirSync 移除 reparse point 而不递归。
          try { unlinkSync(p); } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'EPERM' || code === 'EISDIR') {
              try { rmdirSync(p); } catch { /* ignore */ }
            }
          }
        }
      }
    }
  };
  // 清理必须无条件执行（即使 profile node_modules 已被 pnpm 删除），否则卸载后的悬空
  // junction 永不清理。顶层 + 各 @scope 子目录（社区插件可能是 @scope/name）。
  pruneDangling(rootNm);
  for (const entry of readdirSync(rootNm)) {
    if (entry.startsWith('@')) {
      try { if (lstatSync(join(rootNm, entry)).isDirectory()) pruneDangling(join(rootNm, entry)); } catch { /* ignore */ }
    }
  }

  // 以下为"把 profile 已装插件链接到 dsh 根"逻辑，需要 profile node_modules 存在。
  const profileNm = join(home, 'profiles', 'desktop', 'node_modules');
  if (!existsSync(profileNm)) return;
  // (1) 顶层 profile node_modules：用户直接安装的插件（dependencies 顶层）。
  //     跳过 .pnpm（虚拟存储，单独处理）、.bin、其他点文件。
  linkFlatNodeModules(profileNm, rootNm, new Set(['.pnpm']));
  // (2) pnpm 虚拟存储的扁平化目录：profile/node_modules/.pnpm/node_modules/，
  //     pnpm 在此放所有「安装闭包内」包的 junction（含直接依赖的传递依赖），
  //     每个 junction 指向 .pnpm/<pkg>@ver_hash/node_modules/<pkg>，后者即该包
  //     解析其自身依赖的锚点。部分插件（如 dsh-web-ui-all 聚合包）的 cordis.patch.yml
  //     会把十几个传递依赖（@linxin666/dsh-client-ui-* 等）声明为 loader entry，
  //     loader 裸名 import 它们时沿 dsh 根目录树查找，仅链接顶层直接依赖会
  //     ERR_MODULE_NOT_FOUND。故把虚拟存储扁平化目录也整体链接到 dsh 根 node_modules
  //     （nearest-wins：dsh-dist 已物化/顶层已链接的包不覆盖，避免版本错配）。
  const pnpmFlatNm = join(profileNm, '.pnpm', 'node_modules');
  if (existsSync(pnpmFlatNm)) linkFlatNodeModules(pnpmFlatNm, rootNm);
}

/**
 * 把一个「扁平 node_modules 目录」（顶层为 unscoped 包 + @scope/ 子目录）中的每个包
 * 以 junction 链接到 destRoot（dsh 根 node_modules），使 loader 裸名 import 可解析。
 * nearest-wins：destRoot 已存在的条目（dsh-dist 物化的运行时依赖、顶层已链接的直接
 * 依赖）不覆盖，保证宿主自带版本优先、避免版本错配。
 *
 * @param skipTop 顶层需跳过的条目名（如 profileNm 的 `.pnpm` 本身）
 */
function linkFlatNodeModules(srcNm: string, destRoot: string, skipTop?: Set<string>): void {
  for (const entry of readdirSync(srcNm)) {
    if (entry === '.bin' || entry.startsWith('.')) continue;
    if (skipTop?.has(entry)) continue;
    const src = join(srcNm, entry);
    let stat;
    try { stat = statSync(src); } catch { continue; }
    if (!stat.isDirectory() && !stat.isSymbolicLink()) continue;
    if (entry.startsWith('@')) {
      // scoped 包：链接其下每个包
      const scopeDest = join(destRoot, entry);
      mkdirSync(scopeDest, { recursive: true });
      for (const pkg of readdirSync(src)) {
        const s = join(src, pkg);
        const d = join(scopeDest, pkg);
        if (existsSync(d)) continue;
        try { symlinkSync(s, d, 'junction'); } catch { /* 忽略竞争/权限 */ }
      }
    } else {
      const d = join(destRoot, entry);
      if (existsSync(d)) continue;
      try { symlinkSync(src, d, 'junction'); } catch { /* 忽略竞争/权限 */ }
    }
  }
}

/**
 * 启动 dsh Host（desktop profile，进程内，MVP）。
 * 返回 HostHandle；dsh 未构建 / 启动失败时返回 null（主进程据此显示兜底页）。
 */
export async function startHost(): Promise<HostHandle | null> {
  const entry = findProfileBootEntry();
  if (!entry) {
    console.error('[dsh-desktop] dsh 未构建或产物缺失，宿主未启动');
    return null;
  }
  // 独立 DSH_HOME：避免污染用户全局 ~/.dsh；profile 与会话数据落在应用 userData
  if (!process.env.DSH_HOME) {
    process.env.DSH_HOME = join(app.getPath('userData'), '.dsh');
  }
  ensureDesktopProfile(process.env.DSH_HOME);
  // 开发模式需把 dsh workspace 包链接到根 node_modules（loader 默认 ESM import 解析）；
  // 打包后 dsh-dist 的 node_modules 已由 pnpm deploy 物化为扁平真实文件，无需链接。
  if (!app.isPackaged) {
    ensureWorkspaceLinks();
    ensureDshMarketMaterialized();
  }
  // dshmarket 的 client bundle 由 dsh-client-modules（baseUrl=profile 目录）扫描服务，
  // 需链接到 $DSH_HOME/profiles/node_modules（开发/打包均需）。
  ensureDshMarketProfileLink();
  // 用户通过市场安装的插件位于 profile 的 node_modules，需 junction 到 dsh 根 node_modules，
  // 否则打包态（pnpm 独立目录树）loader 裸名 import 无法解析、Host 启动失败。
  ensureProfilePluginLinks();
  // dsh 的 HMR 依赖 Node 内部 API（--expose-internals / node-addon-require-builtin），
  // Electron 下不可用，禁用之（生产桌面壳无需用户 patch 热重载）。
  process.env.DSH_DISABLE_HMR = '1';

  try {
    // 动态 import dsh 的 ESM 编译产物（与 dsh CLI bin.js 的方式一致）；
    // 产物内部的 @deepseek-ai/* workspace 依赖由 Node 从 dsh 的 node_modules 解析。
    const profileBoot = await import(pathToFileURL(entry).href);
    const appBoot = await import(pathToFileURL(DSH_APP_BOOT_LIB).href);
    const runProfile = profileBoot.runProfile as DshRunProfile;
    const loadLayeredEnv = appBoot.loadLayeredEnv as (binName: string) => unknown;

    const { ctx, shutdown } = await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: 'desktop',
      patchFiles: [],
      // --no-open：桌面壳自带渲染窗口，禁止 dsh web 再去拉起系统默认浏览器
      //   （Electron 下 process.execPath 是 electron.exe，那个 spawn 本就会失败）。
      // --port 0：由 OS 分配空闲端口。
      args: ['--no-open', '--port', '0'],
    });
    const port = ctx.webServer.port;
    // dsh v0.1.2-rc.1 起强制启动令牌鉴权：裸 `/` 返回 401
    // （“dsh web authentication required”）。必须加载携带本进程 launch token
    // 的根 URL，由 dsh 完成一次 token→cookie 交换后重定向到干净 `/`。
    const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${port}/`);
    console.log(`[dsh-desktop] host 就绪: ${url}`);
    return {
      ctx,
      shutdown: (code) => shutdown.shutdown(code ?? 0),
      port,
      url,
    };
  } catch (err) {
    // 完整打印（含 AggregateError 的 errors 数组与 cause 链），便于定位失败插件
    console.error('[dsh-desktop] host 启动失败:', inspect(err, { depth: 8, colors: false }));
    return null;
  }
}
