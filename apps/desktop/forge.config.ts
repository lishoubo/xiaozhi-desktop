import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { environmentProfile } from './vite-plugins/app-env';
import { resolveAuthVariant } from './vite-plugins/auth-variant';

const nativeRuntimeDependencies = ['better-sqlite3', 'node-addon-api'] as const;
const require = createRequire(import.meta.url);
const authVariant = resolveAuthVariant();
const privateCaPath = process.env.HOTEL_BUTLER_PRIVATE_CA_PATH?.trim();
if (privateCaPath && path.basename(privateCaPath) !== 'private-ca.pem') {
  throw new Error('HOTEL_BUTLER_PRIVATE_CA_PATH must point to a file named private-ca.pem');
}

/**
 * 应用标识随构建环境变化，让 dev / pre / online 三套包能并存安装。
 *
 * `name` 同时决定 `app.getName()`，进而决定各平台的数据目录与日志目录——
 * **存储隔离靠的就是这一个字段**，主进程里不需要任何 `app.setPath` 或平台分支。
 */
const profile = environmentProfile();

/**
 * 环境与登录变体是**两根正交的轴**：环境决定连哪个后端与数据目录，变体决定装哪套登录。
 * 两者都要体现在应用标识里，否则 `staff` 与 `phone` 的包会共用同一份数据目录。
 */
const isPhone = authVariant === 'phone';

const config: ForgeConfig = {
  buildIdentifier: authVariant,
  packagerConfig: {
    asar: true,
    name: isPhone ? `${profile.productName}(手机登录)` : profile.productName,
    appBundleId: isPhone ? `${profile.bundleId}.phone` : profile.bundleId,
    executableName: isPhone ? 'hotel-butler-phone' : undefined,
    extraResource: privateCaPath ?? undefined,
  },
  hooks: {
    // Forge's Vite plugin excludes externalized modules from the packaged app, so copy the
    // native runtime tree before Packager prunes and AutoUnpackNatives extracts its binaries.
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      await Promise.all(
        nativeRuntimeDependencies.map(async (dependency) => {
          await fs.cp(
            path.dirname(require.resolve(`${dependency}/package.json`)),
            path.join(buildPath, 'node_modules', dependency),
            {
              recursive: true,
              dereference: true,
              force: true,
            },
          );
        }),
      );
    },
  },
  rebuildConfig: {},
  makers: [
    // Squirrel 用 `name` 决定 `%LOCALAPPDATA%\<name>` 与注册表卸载项，三环境必须不同
    // 才不会互相覆盖安装。这里用 ASCII slug 而非中文展示名：Squirrel 对非 ASCII
    // 字符支持不佳，展示名交给 `setupExe` 与 packagerConfig.name。
    new MakerSquirrel({
      name: isPhone ? `${profile.squirrelName}-phone` : profile.squirrelName,
      setupExe: `${profile.productName}${isPhone ? '-phone' : ''}-setup.exe`,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    new AutoUnpackNativesPlugin({}),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
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
