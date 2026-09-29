#!/usr/bin/env node
/**
 * 收集 dsh 部署产物：pnpm deploy 物化依赖闭包 → 物化 Junction → 补全 @deepseek-ai 包
 * 与非 hoisted 依赖 → 复制 web dist。
 *
 * 产出 desktop/dsh-dist/（真实文件、无 Junction、无 .pnpm），供 forge extraResource 打进
 * out/resources/dsh-dist。前置：dsh 已构建（npm run build:dsh）。
 *
 * 背景：pnpm deploy --legacy 物化的 node_modules 是「链接结构」（外部依赖为 Junction 指向
 * .pnpm store），打包分发后指向失效，故需物化为真实文件。且 deploy 不物化：① peerDependencies
 * （如 cordis-plugin-group、大量 packages 下插件）；② 非 hoisted 的外部依赖（如 zod）。
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// pnpm/tsdown 在无 TTY 时中止模块重建与依赖检查，故设 CI 使其自动处理。
// CI=true 同时让 dsh 的 install-lefthook postinstall 跳过 git hook 安装：本工作区
// dsh 是 git submodule（common config 含 core.worktree），lefthook 的 worktreeConfig
// 迁移会失败；而 pnpm deploy 产出的只是打包副本，本就不需要 git hooks。
process.env.CI = process.env.CI ?? 'true';
process.env.npm_config_confirm_modules_purge = 'false';
process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dshRoot = resolve(desktopRoot, '../deepseek-harness');
const distDir = resolve(desktopRoot, 'dsh-dist');

function run(cmd, cwd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

/** 读取物化后包的依赖/peer 依赖清单（用于补全 .pnpm 作用域 sibling）。 */
function readDependencyNames(pkgDir) {
  try {
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    return [...new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ])];
  } catch {
    return [];
  }
}

/** 读取某目录对应包的版本号（用于版本冲突判定）。 */
function readPackageVersion(pkgDir) {
  try {
    return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
  } catch {
    return undefined;
  }
}

/**
 * 物化单个 .pnpm 包后，补全其作用域 sibling 依赖。
 *
 * Junction 目标（realpath）形如 `.pnpm/<pkg>@<hash>/node_modules/<pkg>`，pnpm 把该包闭包
 * 内的依赖以 sibling Junction 放在同级 `node_modules/`。cpSync 只复制了包自身目录。
 *
 * 关键：不能对每个包都整份复制依赖（会产生海量重复、撑爆打包内存）。只有当作用域 sibling
 * 的版本与顶层 node_modules 中的版本「不同或缺失」时才嵌套复制——即真正存在版本冲突的依赖
 * （如 execa 需要 get-stream@9，而顶层是 dev 链的 @5）。版本一致时由 Node 向上解析到顶层。
 *
 * @param scopeRoot 原始包在 .pnpm 中的真实目录（Junction realpath 目标）
 * @param destPkg 物化后的包副本目录
 */
function materializePackageScopeDeps(scopeRoot, destPkg) {
  const scopeNm = resolve(scopeRoot, '..'); // .pnpm/<pkg>@<hash>/node_modules
  const pnpmSep = join('.pnpm', ''); // `.pnpm` + 平台分隔符（/ 或 \）
  if (!scopeNm.includes(pnpmSep)) return;
  // 顶层 node_modules：scopeNm = <dist>/node_modules/.pnpm/<entry>/node_modules
  const topNm = resolve(scopeNm, '../../../');
  const wanted = new Set(readDependencyNames(scopeRoot));
  if (wanted.size === 0) return;
  for (const name of wanted) {
    const segments = name.split('/');
    const depLink = join(scopeNm, ...segments);
    let depSt;
    try {
      depSt = lstatSync(depLink);
    } catch {
      continue; // 作用域无该 sibling（optional 缺失等），交由其他路径解析
    }
    if (!depSt.isSymbolicLink() && !depSt.isDirectory()) continue;
    let depReal;
    try {
      depReal = depSt.isSymbolicLink() ? realpathSync(depLink) : depLink;
    } catch {
      continue;
    }
    // 版本冲突判定：顶层无该包或版本不同才需要嵌套复制。
    const scopeVersion = readPackageVersion(depReal);
    const topVersion = readPackageVersion(join(topNm, ...segments));
    if (topVersion !== undefined && topVersion === scopeVersion) continue;
    const dest = join(destPkg, 'node_modules', ...segments);
    if (existsSync(dest)) continue;
    try {
      cpSync(depReal, dest, { recursive: true, dereference: true });
      console.log(`[collect-dsh] 嵌套冲突依赖 ${name}@${scopeVersion ?? '?'} → ${basename(scopeRoot)}/node_modules`);
    } catch (err) {
      console.warn(`[collect-dsh] 嵌套冲突依赖失败 ${name}: ${err.message}`);
    }
  }
}

/** 递归物化目录下的 Junction 为真实文件（跳过 .bin 与 .pnpm）。 */
function materializeJunctions(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.name === '.bin' || entry.name === '.pnpm') continue;
    let st;
    try {
      st = lstatSync(fullPath);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      let scopeRoot;
      try {
        scopeRoot = realpathSync(fullPath);
      } catch (err) {
        console.warn(`[collect-dsh] 解析 junction 失败 ${fullPath}: ${err.message}`);
        continue;
      }
      try {
        rmSync(fullPath, { recursive: true, force: true });
        cpSync(scopeRoot, fullPath, { recursive: true, dereference: true });
        // 补全该包在 .pnpm 作用域中的 sibling 依赖（必须在 .pnpm 删除前执行）
        materializePackageScopeDeps(scopeRoot, fullPath);
      } catch (err) {
        console.warn(`[collect-dsh] 物化失败 ${fullPath}: ${err.message}`);
      }
    } else if (st.isDirectory()) {
      materializeJunctions(fullPath, depth + 1);
    }
  }
}

/** 复制单个 @deepseek-ai 包（lib + package.json + cordis.patch.yml 等，排除 node_modules）。 */
function copyPackage(pkgDir, destRoot) {
  const pkgJson = resolve(pkgDir, 'package.json');
  if (!existsSync(pkgJson)) return;
  let name;
  try {
    name = JSON.parse(readFileSync(pkgJson, 'utf8')).name;
  } catch {
    return;
  }
  if (!name || !name.startsWith('@deepseek-ai/')) return;
  const shortName = name.slice('@deepseek-ai/'.length);
  const dest = resolve(destRoot, shortName);
  if (existsSync(dest)) return; // 已物化
  cpSync(pkgDir, dest, {
    recursive: true,
    dereference: true,
    // 排除 node_modules：嵌套依赖是 Junction 指向其它包，递归物化会循环；扁平结构里已有
    filter: (src) => !src.includes('node_modules'),
  });
  console.log(`[collect-dsh] 物化 @deepseek-ai/${shortName}`);
}

/** 递归复制 dshmarket 的运行时依赖（dependencies 字段 + 传递依赖）到物化目录，@deepseek-ai scope 从宿主解析。 */
function copyMarketRuntimeDeps(srcNm, destNm, marketRoot) {
  let queue = [];
  try {
    queue = Object.keys(JSON.parse(readFileSync(resolve(marketRoot, 'package.json'), 'utf8')).dependencies ?? {});
  } catch {
    return;
  }
  const seen = new Set();
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name) || name.startsWith('@deepseek-ai/')) continue;
    seen.add(name);
    const srcPkg = resolve(srcNm, name);
    const destPkg = resolve(destNm, name);
    if (!existsSync(resolve(srcPkg, 'package.json')) || existsSync(resolve(destPkg, 'package.json'))) continue;
    cpSync(srcPkg, destPkg, { recursive: true, dereference: true });
    try {
      const deps = JSON.parse(readFileSync(resolve(srcPkg, 'package.json'), 'utf8')).dependencies ?? {};
      for (const dep of Object.keys(deps)) queue.push(dep);
    } catch {
      // 跳过无法解析的传递依赖
    }
  }
}

/** 物化 dsh-market（插件市场，非 scoped 包）到 dsh-dist/node_modules/dshmarket。
 *  复制 package.json + cordis.patch.yml + lib/ + client/ + 运行时依赖（undici/js-yaml 等），
 *  排除源码/测试/devDeps；@deepseek-ai 依赖从宿主 dsh-dist 解析。 */
function collectDshMarket() {
  const marketRoot = resolve(desktopRoot, '../dsh-market');
  const dest = resolve(distDir, 'node_modules/dshmarket');
  if (!existsSync(resolve(marketRoot, 'package.json'))) {
    console.error(`[collect-dsh] dsh-market 未找到（打包必需，先构建 ../dsh-market）: ${marketRoot}`);
    process.exit(1);
  }
  if (existsSync(resolve(dest, 'package.json'))) {
    console.log('[collect-dsh] dshmarket 已物化');
    return;
  }
  cpSync(marketRoot, dest, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const rel = src.slice(marketRoot.length + 1);
      if (rel === '') return true;
      const top = rel.split(/[\\/]/)[0];
      return top === 'package.json' || top === 'cordis.patch.yml' || top === 'lib' || top === 'client';
    },
  });
  // 复制运行时依赖（dshmarket 的 dependencies，如 undici/js-yaml）
  const srcNm = resolve(marketRoot, 'node_modules');
  if (existsSync(srcNm)) {
    copyMarketRuntimeDeps(srcNm, resolve(dest, 'node_modules'), marketRoot);
  }
  console.log('[collect-dsh] 物化 dshmarket（lib/client/cordis.patch.yml/package.json + 运行时依赖）');
}

/** 补全所有 @deepseek-ai 包（packages、vendor、apps 下），覆盖 peer 依赖与 link: override。 */
function collectWorkspacePackages() {
  const destRoot = resolve(distDir, 'node_modules/@deepseek-ai');
  for (const root of ['packages', 'vendor', 'apps']) {
    const rootDir = resolve(dshRoot, root);
    if (!existsSync(rootDir)) continue;
    for (const cat of readdirSync(rootDir)) {
      const catDir = resolve(rootDir, cat);
      if (!existsSync(catDir)) continue;
      if (existsSync(resolve(catDir, 'package.json'))) {
        copyPackage(catDir, destRoot); // 一级（vendor/*、apps/*）
      } else {
        try {
          for (const pkg of readdirSync(catDir)) {
            copyPackage(resolve(catDir, pkg), destRoot); // 两级（packages/*/*）
          }
        } catch {
          // 非目录，跳过
        }
      }
    }
  }
}

/** 物化非 hoisted 的外部依赖到顶层 node_modules。
 *  从每个 .pnpm entry 的 node_modules 子目录提取真实包名（entry 名可能是截断+hash，
 *  如 @opentelemetry+exporter-log_8841...，真实包名在 node_modules/@opentelemetry/exporter-logs-otlp-http）。 */
function collectNonHoistedDeps() {
  const pnpmDir = resolve(distDir, 'node_modules/.pnpm');
  const topDir = resolve(distDir, 'node_modules');
  if (!existsSync(pnpmDir)) return;
  const seen = new Set();
  const materialize = (entry, pkgName) => {
    if (seen.has(pkgName)) return;
    seen.add(pkgName);
    const dest = resolve(topDir, ...pkgName.split('/'));
    if (existsSync(dest)) return; // 已 hoisted 或已物化
    const nested = resolve(pnpmDir, entry, 'node_modules', ...pkgName.split('/'));
    if (!existsSync(nested)) return;
    cpSync(nested, dest, { recursive: true, dereference: true });
    console.log(`[collect-dsh] 物化非 hoisted 依赖 ${pkgName}`);
  };
  for (const entry of readdirSync(pnpmDir)) {
    const entryNodeModules = resolve(pnpmDir, entry, 'node_modules');
    if (!existsSync(entryNodeModules)) continue;
    for (const scopeOrName of readdirSync(entryNodeModules)) {
      const full = resolve(entryNodeModules, scopeOrName);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (scopeOrName.startsWith('@')) {
        for (const name of readdirSync(full)) {
          materialize(entry, `${scopeOrName}/${name}`);
        }
      } else {
        materialize(entry, scopeOrName);
      }
    }
  }
}

/** 递归清理原生模块中非目标平台的 prebuilds（如 node-pty 的 linux-arm64/win32-x64 等），
 *  避免 rpmbuild 的 brp-strip 遇到非目标架构 .node 报错，并减小包体积。 */
function pruneForeignPrebuilds(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const target = `${process.platform}-${process.arch}`;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = join(dir, entry.name);
    if (entry.name === 'prebuilds') {
      for (const sub of readdirSync(fullPath)) {
        const subPath = resolve(fullPath, sub);
        let st;
        try {
          st = lstatSync(subPath);
        } catch {
          continue;
        }
        if (!st.isDirectory()) continue;
        if (sub !== target) {
          rmSync(subPath, { recursive: true, force: true });
          console.log(`[collect-dsh] 清理非目标架构 prebuilds: ${sub}`);
        }
      }
    } else {
      pruneForeignPrebuilds(fullPath, depth + 1);
    }
  }
}

// 0. 校验
if (!existsSync(dshRoot)) {
  console.error(`[collect-dsh] dsh 未找到: ${dshRoot}`);
  process.exit(1);
}

// 1. 清理旧产物
if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });

// 2. pnpm deploy 物化依赖闭包（apps/cli 的 dependencies 含 web profile 全部插件）
run(`corepack pnpm --filter @deepseek-ai/dsh deploy --legacy "${distDir}"`, dshRoot);

// 3. 先物化非 hoisted 依赖（zod / get-stream@5 等）到顶层，使下一步 Junction 物化时的
//    版本冲突判定能看到完整顶层版本（该步骤须在 .pnpm 删除前完成）。
console.log('\n[collect-dsh] 物化非 hoisted 依赖...');
collectNonHoistedDeps();

// 4. 物化顶层 Junction（js-yaml、execa 等）
console.log('\n[collect-dsh] 物化 Junction 为真实文件...');
materializeJunctions(join(distDir, 'node_modules'));

// 5. 补全 @deepseek-ai 包（peer 依赖与 link: override）
console.log('\n[collect-dsh] 补全 @deepseek-ai 包...');
collectWorkspacePackages();

// 5b. 物化 landlock-run 入口包（native 原生模块，win32 无平台 .node，但沙箱插件静态 import 其入口；
//     产品概念设计已确认 MVP 裁掉 landlock 原生沙箱，此处仅物化入口使 import 不报错）
const landlockEntry = resolve(dshRoot, 'native/landlock-run/packages/entry');
copyPackage(landlockEntry, resolve(distDir, 'node_modules/@deepseek-ai'));

// 6. 删除 .pnpm store（已物化，冗余）
const pnpmStore = resolve(distDir, 'node_modules/.pnpm');
if (existsSync(pnpmStore)) rmSync(pnpmStore, { recursive: true, force: true });

// 6b. 清理非目标架构的原生模块 prebuilds（node-pty 等），避免 rpmbuild brp-strip 失败
console.log('\n[collect-dsh] 清理非目标架构 prebuilds...');
pruneForeignPrebuilds(join(distDir, 'node_modules'));

// 7. 复制 web dist（pnpm deploy 不物化 build 产物，frontend-static 经
//    require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html') 定位）
const webDist = resolve(dshRoot, 'apps/web/dist');
const webFrontendDist = resolve(distDir, 'node_modules/@deepseek-ai/dsh-web-frontend/dist');
if (existsSync(webDist)) {
  cpSync(webDist, webFrontendDist, { recursive: true });
  console.log('[collect-dsh] web dist 已复制到 dsh-web-frontend/dist');
} else {
  console.error('[collect-dsh] web dist 缺失（先跑 npm run build:dsh）');
  process.exit(1);
}

// 8. 复制 desktop profile 到 dsh-dist/profiles/desktop（供 host.ts 复制到 $DSH_HOME）
const profileSrc = resolve(desktopRoot, 'profiles/desktop');
const profileDest = resolve(distDir, 'profiles/desktop');
if (existsSync(profileSrc)) {
  cpSync(profileSrc, profileDest, { recursive: true });
  console.log('[collect-dsh] desktop profile 已复制到 dsh-dist/profiles/desktop');
}

// 9. 物化 dsh-market（插件市场）到 dsh-dist/node_modules/dshmarket
collectDshMarket();

console.log(`\n[collect-dsh] 完成: ${distDir}`);
