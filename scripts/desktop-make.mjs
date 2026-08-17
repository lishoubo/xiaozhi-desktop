#!/usr/bin/env node
/**
 * 打包桌面应用：先清理，再把参数原样交给 Electron Forge make。
 *
 * ## 环境从哪来
 *
 * `XIAOZHI_APP_ENV` 由调用方（npm script）设定，本脚本只做校验与回显——**不设默认
 * 值兜底**，因为 `app-env-profiles.mjs` 已经定义了缺省行为，在这里再补一层只会让
 * "到底生效了哪个值"变得难查。
 *
 * 打包前回显环境与 RMS 地址：出包后再想确认"这包连的哪个后端"就得去翻产物了，
 * 而这行输出会留在 CI 日志里。
 *
 * ## 为什么是 Node 而不是 sh
 *
 * 应用要装到 Windows，`#!/bin/sh` 在那儿跑不了。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** `--target` 的简写表：省得每次手敲 `--platform=x --arch=y` 两个参数。 */
const TARGETS = {
  'mac-arm64': ['--platform=darwin', '--arch=arm64'],
  'mac-intel': ['--platform=darwin', '--arch=x64'],
  win64: ['--platform=win32', '--arch=x64'],
  linux64: ['--platform=linux', '--arch=x64'],
};

const USAGE = `用法: node scripts/desktop-make.mjs --env=<dev|pre|online> [选项] [Forge 参数]

选项:
  --env=<dev|pre|online>   构建环境（必填，决定应用名/bundleId/RMS 地址）
  --target=<名称>          目标平台简写: ${Object.keys(TARGETS).join(' | ')}
                           缺省为当前机器。
                           ⚠ win64 在 macOS/Linux 上只能走到 package（产出
                           .exe 目录），**做 Squirrel 安装包需要 Mono + Wine**，
                           否则报 "You must install both Mono and Wine"。
                           要出 .exe 安装包请在 Windows 上跑，或先装
                           mono 与 wine-stable。配合 --package-only 可在 macOS
                           上仅验证产物内容。
  --package-only           只 package 不 make（不产出安装包，用于快速验证产物）
  -h, --help               显示帮助

环境经 --env 指定（不用 npm script 前缀写 XIAOZHI_APP_ENV=，那种写法在 Windows 的
cmd/PowerShell 上不成立）。也可直接设 XIAOZHI_APP_ENV 环境变量，--env 优先。

打包前会固定清理构建缓存、打包产物与该环境的用户数据，其余参数原样传给 Forge。

示例:
  npm run make:desktop:pre                  当前平台的预发包
  npm run make:desktop:pre:win64            预发的 Windows 包
  npm run make:desktop:online:mac:arm64     正式的 macOS Apple Silicon 包
  node scripts/desktop-make.mjs --env=pre --target=win64
`;

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(USAGE);
  process.exit(0);
}

// 本脚本自己的开关归自己，其余原样转发给 Forge。
const envFlag = argv.find((arg) => arg.startsWith('--env='));
const targetFlag = argv.find((arg) => arg.startsWith('--target='));
const packageOnly = argv.includes('--package-only');
const forwarded = argv.filter(
  (arg) =>
    !arg.startsWith('--env=') && !arg.startsWith('--target=') && arg !== '--package-only',
);

if (targetFlag !== undefined) {
  const target = targetFlag.slice('--target='.length);
  const expanded = TARGETS[target];
  if (expanded === undefined) {
    console.error(`--target 取值非法: ${target}（可选 ${Object.keys(TARGETS).join(' | ')}）`);
    process.exit(1);
  }
  forwarded.push(...expanded);
}

const { environmentProfile, resolveAppEnvironment } = await import(
  pathToFileURL(path.join(repoRoot, 'apps', 'desktop', 'vite-plugins', 'app-env-profiles.mjs')).href
);

// 非法值在这里就炸掉，不要等 Forge 跑完一轮构建才发现。
const requested =
  envFlag === undefined ? process.env : { ...process.env, XIAOZHI_APP_ENV: envFlag.slice(6) };
const appEnv = resolveAppEnvironment(requested);
const profile = environmentProfile(requested);
const rmsOrigin = process.env.XIAOZHI_RMS_SERVER_URL ?? profile.rmsOrigin;

if (rmsOrigin === null) {
  console.error(
    `环境 ${appEnv} 尚未配置默认 RMS 地址。\n` +
      '请在 apps/desktop/vite-plugins/app-env-profiles.mjs 的 PROFILES 中填入，' +
      '或显式设置 XIAOZHI_RMS_SERVER_URL。',
  );
  process.exit(1);
}

console.log(`环境: ${appEnv}`);
console.log(`应用名: ${profile.productName}（${profile.bundleId} / ${profile.squirrelName}）`);
console.log(`RMS 地址: ${rmsOrigin}`);
console.log(`目标: ${targetFlag === undefined ? '当前平台' : targetFlag.slice('--target='.length)}`);

// 明文 HTTP 需要显式豁免（见 vite-plugins/rms-origin.ts）。pre 环境的 RMS 目前就是
// 明文裸 IP，这里替它把豁免打开并**每次都告警**——豁免必须是看得见的，不能藏在
// 配置默认值里。RMS 上 HTTPS 之后，改 PROFILES 里的地址即可自动恢复强制校验。
const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(rmsOrigin);
const needsInsecureOptOut = !rmsOrigin.startsWith('https://') && !isLoopback;
if (needsInsecureOptOut && process.env.XIAOZHI_ALLOW_INSECURE_RMS !== '1') {
  console.warn(`警告: RMS 地址为明文 HTTP（${rmsOrigin}），JWT 将以明文传输。`);
}

// 显式下传：子进程要拿到同一个环境值，不能依赖调用方的 shell 语法（Windows 上
// `FOO=bar cmd` 不成立）。RMS 地址一并固定，免得 profile 默认值与实际打进去的不一致。
const childEnvironment = {
  ...process.env,
  XIAOZHI_APP_ENV: appEnv,
  XIAOZHI_RMS_SERVER_URL: rmsOrigin,
  ...(needsInsecureOptOut ? { XIAOZHI_ALLOW_INSECURE_RMS: '1' } : {}),
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: childEnvironment,
    // Windows 上 npm 是 npm.cmd，必须走 shell 才找得到。
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [path.join(repoRoot, 'scripts', 'desktop-clean.mjs')]);
// `package` 只出 .app/.exe 目录，`make` 还会打成 zip/Squirrel 安装包。
const forgeCommand = packageOnly ? 'package' : 'make';
run('npm', ['run', forgeCommand, '--workspace', '@hotel-butler/desktop', '--', ...forwarded]);
