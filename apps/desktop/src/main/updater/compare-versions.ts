/**
 * 版本号比较 —— 只给不能自动更新的平台用（macOS）。
 *
 * Windows 不走这里：Squirrel 自己比对 `RELEASES`，那是它的事实来源。
 *
 * 只认 `主.次.修订` 三段数字，够用就行：本项目的版本号由
 * `apps/desktop/package.json` 的 `version` 决定，从来只有这一种形状。
 * 不引 semver 包 —— 为一次字符串比较加一个运行时依赖不划算。
 *
 * 预发布后缀（`1.0.1-beta`）按"忽略后缀"处理，即与 `1.0.1` 等同。本项目不发
 * 预发布版，真要发了这里的行为会偏保守（不提示升级），不会误判成有新版本。
 */

/** 解析失败返回 `null`；调用方按"无法判断"处理，不要当成 0。 */
function parseVersion(value: string): readonly number[] | null {
  const parts = value.trim().split('-')[0]?.split('.') ?? [];
  if (parts.length !== 3) return null;

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((number) => !Number.isInteger(number) || number < 0)) return null;
  return numbers;
}

/**
 * `latest` 是否比 `current` 新。
 *
 * 任一无法解析时返回 `false`——**保守不提示**。名单是人工编辑的，把
 * `latestVersion` 写成 `"最新版"` 这类值时，宁可不提示也不要弹一个假通知。
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const left = parseVersion(latest);
  const right = parseVersion(current);
  if (left === null || right === null) return false;

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}
