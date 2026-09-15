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
  /**
   * 最新版本号与下载地址，**只给不能自动更新的平台用**（macOS）。
   *
   * Windows 不读这两个字段：Squirrel 自己比对 `RELEASES`，那才是它的事实来源。
   * 这里再放一份是为了让 macOS 也能判断"有没有新版本"——它没有 Squirrel，
   * 而解析 Windows 的包名（`xiaozhi-hotel-1.0.1-full.nupkg`）来判断 Mac 的版本
   * 既别扭又会随包名规则失效。
   *
   * 两者 MUST 可选：线上已经有一份不含它们的名单，设成必填会让解析失败，
   * 连带把 Windows 的更新一起停掉。
   */
  latestVersion: z.string().optional(),
  /**
   * 按架构给下载地址。用户分不清自己是 M 芯片还是 Intel，让他们在下载页上选
   * 很容易选错，下回来打不开还得找客服——所以由应用按 `process.arch` 自动挑。
   */
  downloadUrls: z
    .strictObject({
      arm64: z.string().optional(),
      x64: z.string().optional(),
    })
    .optional(),
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
