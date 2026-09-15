/**
 * 自动更新源地址。
 *
 * 取值在构建期完成（见 vite-plugins/update-feed.ts）：`__UPDATE_FEED_URL__` 是被
 * Rollup 折叠掉的字面量。与 `rms-endpoint.ts` 同理不在运行时读 `process.env`——
 * 打包产物被双击启动时父进程环境里没有那个变量。
 *
 * ## 两个地址由一个配置派生
 *
 * ```
 * <feedUrl>/updates/              Squirrel 的 feed：RELEASES + *.nupkg
 * <feedUrl>/update-manifest.json  灰度名单
 * ```
 *
 * 不各配一个字段：两者恒在同一个 bucket 下，分开配只会多一处可以配错的地方。
 */

/**
 * Squirrel 产物的子目录，按平台分开。上传脚本按同一约定推送。
 *
 * **为什么按平台分目录**：Squirrel.Windows 与 Squirrel.Mac 都用 `RELEASES`
 * 这个文件名，混在一个目录里两者没法共存。现在 Mac 还不做自动更新，但
 * **feedUrl 是写死在已发布产物里的、改不了**——等哪天做 Mac 自动更新时再分，
 * 那时装着老版本的客户就接不上了。
 */
const UPDATE_FEED_SUBDIRECTORY = 'win32';

/** 灰度名单的文件名。 */
const GRAY_RELEASE_MANIFEST_FILE = 'update-manifest.json';

/** `null` 表示本环境不启用自动更新（dev / pre 默认如此）。 */
function resolveUpdateOrigin(): string | null {
  const origin = __UPDATE_FEED_URL__;
  return origin === '' ? null : origin;
}

/** Squirrel 的 feed 地址；`null` 表示本环境不启用自动更新。 */
export function resolveUpdateFeedUrl(): string | null {
  const origin = resolveUpdateOrigin();
  return origin === null ? null : `${origin}/${UPDATE_FEED_SUBDIRECTORY}`;
}

/** 灰度名单地址；`null` 表示本环境不启用自动更新。 */
export function resolveGrayReleaseManifestUrl(): string | null {
  const origin = resolveUpdateOrigin();
  return origin === null ? null : `${origin}/${GRAY_RELEASE_MANIFEST_FILE}`;
}

/** 手机号哈希盐值；`null` 表示未配置。 */
export function resolveUpdateSalt(): string | null {
  const salt = __UPDATE_SALT__;
  return salt === '' ? null : salt;
}
