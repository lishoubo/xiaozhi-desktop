import { z } from 'zod';
import { digestPhone } from './phone-digest';

/**
 * 灰度名单：决定某台机器这次要不要升级。
 *
 * ## 为什么需要它
 *
 * Squirrel 只认 feed，不认名单——`checkForUpdates()` 一旦调用，它读到 RELEASES
 * 里有新版本就会升，没有"这次别升"的开关。所以灰度只能做在它外面：**名单决定
 * 要不要让 Squirrel 跑，Squirrel 决定怎么升**。
 *
 * ## 名单形态
 *
 * ```jsonc
 * {
 *   "allowAll": false,      // true = 全量放开，忽略 allowlist
 *   "allowlist": [          // sha256(手机号 + 盐) 的 hex
 *     "e2fc714c4727ee9395f324cd2e7f331f..."
 *   ]
 * }
 * ```
 *
 * 全量放开用显式布尔，不用 `["*"]` 这类魔法字符串——后者会让"名单里恰好有个
 * 哈希等于 `*`"变成可疑边界。
 *
 * ## 解析失败为什么不抛错
 *
 * 与 `rms-auth-client.ts` 的契约校验相反：那里契约漂移必须暴露，因为半个身份
 * 对象流进业务层会造成更大的错。而这里名单读不懂时，安全的选择是**当作不命中**
 * ——宁可漏升一次，不可让名单外的机器意外升级。
 */
const grayReleaseManifestSchema = z.strictObject({
  allowAll: z.boolean(),
  allowlist: z.array(z.string()),
});

export type GrayReleaseManifest = Readonly<z.infer<typeof grayReleaseManifestSchema>>;

/** 解析名单；结构非法时返回 `null`，由调用方当作不命中处理。 */
export function parseGrayReleaseManifest(data: unknown): GrayReleaseManifest | null {
  const parsed = grayReleaseManifestSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * 判定某手机号是否命中名单。
 *
 * 名单为 `null`（拉取失败或结构非法）时一律不命中。
 */
export function isPhoneAllowed(
  manifest: GrayReleaseManifest | null,
  phone: string,
  salt: string,
): boolean {
  if (manifest === null) return false;
  if (manifest.allowAll) return true;
  return manifest.allowlist.includes(digestPhone(phone, salt));
}
