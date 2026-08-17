#!/usr/bin/env node
/**
 * 启动桌面应用开发模式。
 *
 * 环境固定为 `dev`：开发态连本机 rms-server、用带 `[开发]` 后缀的数据目录，与任何
 * 已安装的 pre / online 包互不干扰。**在脚本里设而不是靠 npm script 前缀**，是因为
 * `FOO=bar cmd` 这种写法在 Windows 的 cmd/PowerShell 上不成立，而本项目要装到 Windows。
 *
 * 为什么是 Node 而不是 sh：同上，`#!/bin/sh` 在 Windows 上跑不了。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const USAGE = `用法: node scripts/desktop-dev.mjs [--clean] [-- Electron Forge 参数]

选项:
  --clean       启动前清理构建缓存、打包产物与开发环境的用户数据
  -h, --help    显示帮助

示例:
  node scripts/desktop-dev.mjs
  node scripts/desktop-dev.mjs --clean
  node scripts/desktop-dev.mjs --clean -- --inspect-electron
`;

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(USAGE);
  process.exit(0);
}

let shouldClean = false;
const forwarded = [];
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--clean') shouldClean = true;
  else if (arg === '--no-clean') shouldClean = false;
  else if (arg === '--') {
    forwarded.push(...argv.slice(index + 1));
    break;
  } else {
    console.error(`未知参数: ${arg}\n\n${USAGE}`);
    process.exit(2);
  }
}

// 开发态永远是 dev 环境；不接受调用方覆盖，避免开发时误连预发/生产后端。
const environment = { ...process.env, XIAOZHI_APP_ENV: 'dev' };

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: environment,
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (shouldClean) run(process.execPath, [path.join(repoRoot, 'scripts', 'desktop-clean.mjs')]);
run('npm', ['run', 'dev', '--workspace', '@hotel-butler/desktop', '--', ...forwarded]);
