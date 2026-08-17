#!/usr/bin/env node
/**
 * 清理桌面端的构建缓存、打包产物与**某一套环境**的用户数据。
 *
 * ## 为什么是 Node 而不是 sh
 *
 * 应用要装到 Windows，`#!/bin/sh` 在那儿跑不了。原来的 `desktop-clean.sh` 里本来就
 * 嵌了一段 `node -e` 算路径——那段逻辑才是主体，把它扶正成 Node 脚本反而更短。
 *
 * ## 清哪些目录
 *
 * ```
 * apps/desktop/.vite          构建缓存
 * apps/desktop/out            打包产物
 * <userData>/                 该环境的业务库、凭证、partition、账本
 * <logs>/                     该环境的日志
 * ```
 *
 * ⚠️ **日志目录必须单列**：macOS 上它在 `~/Library/Logs/` 而不在 userData 里，只清
 * userData 会留下一份越积越大的日志（真机上已到 17MB）。Windows 与 Linux 上它是
 * userData 的子目录，会被前一步顺带清掉——这里做去重，不重复删。
 *
 * ## 环境
 *
 * 目录名取自 `productName`，而它随 `XIAOZHI_APP_ENV` 变化（见
 * `apps/desktop/vite-plugins/app-env.ts`）。所以**清理只作用于当前环境**，
 * 三套环境的数据互不影响，正是隔离要达到的效果。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const desktopDir = path.join(repoRoot, 'apps', 'desktop');

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log(`用法: scripts/desktop-clean.mjs

清理**当前环境**的构建缓存、打包产物、用户数据与日志。环境由 XIAOZHI_APP_ENV
决定（dev | pre | online，缺省 dev）——三套环境的数据互不影响。

  apps/desktop/.vite     构建缓存
  apps/desktop/out       打包产物
  <userData>/            业务库、凭证、partition、账本
  <logs>/                日志（macOS 上不在 userData 内，单独清）

示例:
  npm run clean:desktop                        清开发环境
  XIAOZHI_APP_ENV=pre scripts/desktop-clean.mjs  清预发环境
`);
  process.exit(0);
}

/** 与 Electron `app.getPath('userData')` / `app.getPath('logs')` 的平台规则一致。 */
function platformDirectories(productName) {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home === undefined) throw new Error('无法确定用户主目录（HOME / USERPROFILE 均未设置）');

  if (process.platform === 'darwin') {
    return {
      userData: path.join(home, 'Library', 'Application Support', productName),
      // macOS 独有：日志不在 userData 内，Apple 的目录约定要求它单独放。
      logs: path.join(home, 'Library', 'Logs', productName),
    };
  }

  const userData =
    process.platform === 'win32'
      ? path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), productName)
      : path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), productName);

  // Windows / Linux：Electron 把日志放在 userData 下，清 userData 即已覆盖。
  return { userData, logs: path.join(userData, 'logs') };
}

async function resolveProductName() {
  const { environmentProfile } = await import(
    pathToFileURL(path.join(desktopDir, 'vite-plugins', 'app-env-profiles.mjs')).href
  );
  return environmentProfile().productName;
}

function removeDirectory(target, allowed) {
  // 白名单守卫沿用 sh 版本：`rm -rf` 打错一个变量就是灾难，宁可多一道确认。
  if (!allowed.includes(target)) {
    console.error(`拒绝清理未声明的目录: ${target}`);
    process.exit(1);
  }
  if (!fs.existsSync(target)) return;
  console.log(`清理 ${target}`);
  fs.rmSync(target, { recursive: true, force: true });
}

const productName = await resolveProductName();
const { userData, logs } = platformDirectories(productName);

// 去重：非 macOS 上 logs 是 userData 的子目录，已被前一步删掉。
const targets = [
  path.join(desktopDir, '.vite'),
  path.join(desktopDir, 'out'),
  userData,
  ...(logs.startsWith(userData + path.sep) ? [] : [logs]),
];

console.log(`环境: ${process.env.XIAOZHI_APP_ENV ?? 'dev'}（应用名 ${productName}）`);
for (const target of targets) removeDirectory(target, targets);
