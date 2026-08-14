/**
 * 携程账号身份读取 —— 从官方 SDK `window.HEAppInfo` 取账号与酒店。
 *
 * ## 为什么不再读 DOM
 *
 * 此前身份取自 `hotel-dom.ts` 的酒店列表（`a.he-ctrip-hotel-title-link`），
 * 于是 `channelAccountId` 存的是**酒店 ID**。携程自己并不这么分：
 *
 * ```
 * HEAppInfo.getUserInfo()   huid 12324831 / userName 银际青山店      ← 账号
 * HEAppInfo.getHotelInfo()  masterHotelId 85068938 / hotelName ...  ← 酒店
 * ```
 *
 * 一个账号管多家门店时「账号 = 酒店」这个等式就塌了，多门店账号因此**探不出
 * 身份、绑不了店**（旧 discovery 只能返回 `kind: 'multiple'` 然后整条链路放弃）。
 * 改用 `huid` 之后账号身份与门店数量无关，口径也终于与抖音（`user_id`）、
 * 美团（登录账号）一致。踩点见 `docs/踩点/携程/账号身份.md`。
 *
 * SDK 也比 class 名稳：`he-ctrip-hotel-title-link` 是携程改版就会失效的实现细节。
 *
 * ## 兜底：HEUbtBaseData
 *
 * `HEAppInfo` 是异步加载的微前端 SDK，登录后落地那一刻未必已挂上。同一份身份
 * 还写在 `window.HEUbtBaseData`（同步的埋点基础数据，字段较少但 huid / userName /
 * masterHotelId / hotelName 都在），SDK 缺席时用它顶上，避免白等一轮超时。
 */
import { z } from 'zod';
import type { JsonObject } from '../../../shared/types/json';

const idLikeSchema = z.union([z.string(), z.number()]);

/**
 * 两条来源归一后的形状。`HEAppInfo` 与 `HEUbtBaseData` 的字段名不同
 * （`userName` vs `username`），差异在页面脚本里就抹平，这里只认一种。
 */
const ctripAccountIdentitySchema = z.object({
  huid: idLikeSchema,
  userName: z.string().nullish(),
  login: z.string().nullish(),
  userType: z.string().nullish(),
  masterHotelId: idLikeSchema.nullish(),
  hotelName: z.string().nullish(),
  identitySource: z.string(),
});

export type CtripCredentialIdentity = Readonly<{
  channelAccountId: string;
  credentialExtra: JsonObject;
}>;

function nonBlank(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function idString(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  // `hotelId: -1` 是携程表达「无」的写法，别当成一个真的酒店。
  if (normalized.length === 0 || normalized === '0' || normalized === '-1') return null;
  return normalized;
}

export function parseCtripAccountIdentity(raw: unknown): CtripCredentialIdentity | null {
  const parsed = ctripAccountIdentitySchema.safeParse(raw);
  if (!parsed.success) return null;

  const channelAccountId = idString(parsed.data.huid);
  if (!channelAccountId) return null;

  const userName = nonBlank(parsed.data.userName);
  const login = nonBlank(parsed.data.login);
  const masterHotelId = idString(parsed.data.masterHotelId);
  const hotelName = nonBlank(parsed.data.hotelName);

  return {
    channelAccountId,
    credentialExtra: {
      huid: channelAccountId,
      // 账号名：UI 上让用户认账号靠它，取不到不阻断（只影响展示）。
      userName,
      login,
      userType: nonBlank(parsed.data.userType),
      // 酒店信息随身份一起存下来：`ctripHotelProbe` 不碰页面，读的就是这两个字段。
      masterHotelId,
      hotelName,
      identitySource: parsed.data.identitySource,
    },
  };
}

/**
 * 先等 `HEAppInfo`（官方 SDK，字段最全），最多 5 秒；没等到就退回同步的
 * `HEUbtBaseData`。两条来源都归一成 `parseCtripAccountIdentity` 认的形状，
 * 并带上 `identitySource` 说明这份数据是从哪来的。
 *
 * 轮询上限写在页面脚本里而不是主进程：主进程侧 `discovery.ts` 还有一层重试，
 * 两层都设长会叠成很长的等待。
 */
export const READ_CTRIP_ACCOUNT_IDENTITY_EXPRESSION = `
  (async () => {
    const readSdk = async () => {
      const api = window.HEAppInfo;
      if (!api || typeof api.getUserInfo !== 'function') return null;
      const user = await api.getUserInfo();
      if (!user || user.huid == null) return null;
      let hotel = null;
      try {
        hotel = typeof api.getHotelInfo === 'function' ? await api.getHotelInfo() : null;
      } catch (error) {
        hotel = null;
      }
      return {
        huid: user.huid,
        userName: user.userName,
        login: user.login,
        userType: user.userType,
        masterHotelId: hotel ? hotel.masterHotelId : null,
        hotelName: hotel ? (hotel.hotelName || hotel.hotelCName) : null,
        identitySource: 'he-app-info',
      };
    };

    const readUbt = () => {
      const ubt = window.HEUbtBaseData;
      if (!ubt || ubt.huid == null) return null;
      return {
        huid: ubt.huid,
        userName: ubt.username,
        login: null,
        userType: ubt.userType,
        masterHotelId: ubt.masterHotelId,
        hotelName: ubt.hotelName,
        identitySource: 'he-ubt-base-data',
      };
    };

    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const fromSdk = await readSdk();
        if (fromSdk) return fromSdk;
      } catch (error) {
        // SDK 还在初始化时调用可能抛错，继续轮询。
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return readUbt();
  })()
`;
