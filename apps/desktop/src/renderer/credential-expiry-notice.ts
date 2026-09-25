import type { OtaCredentialExpiryScannedEvent } from '../shared/browser';
import type { AppNotification } from './notifications';
import { OTA_CHANNELS } from './data/ota-channels';

/** 全局唯一的失效提醒 id —— 同 id 原地替换，界面任一时刻至多一条。 */
export const CREDENTIAL_EXPIRY_NOTICE_ID = 'ota-credential:expired';

/**
 * 10 秒后自动关：扫描约 5 分钟一轮，每轮提醒一次即可，常驻会让没登录的用户一直被挡着。
 * 用户不在电脑前错过这一轮也无妨，下一轮会再提醒。
 */
const NOTICE_DURATION_MS = 10_000;

const CALL_TO_ACTION = '请及时登录，避免影响价量态追齐。';

type ExpiredAccount = OtaCredentialExpiryScannedEvent['accounts'][number];

/** 渠道显示名。用 `shortName`：「您的携程账号」比「您的携程酒店 eBooking账号」通顺。 */
function channelLabel(channel: string): string {
  return OTA_CHANNELS.find((item) => item.id === channel)?.shortName ?? channel;
}

/**
 * 列表最多展示几项。提醒卡片最宽 24rem，账号挂多店时全列出来会占满右上角。
 */
const MAX_LISTED = 2;

/** `[A, B, C, D, E]` → `A、B 等共 5 家门店`；不超过上限时原样用顿号连接。 */
function abbreviate(items: readonly string[], unit: string): string {
  if (items.length <= MAX_LISTED) return items.join('、');
  return `${items.slice(0, MAX_LISTED).join('、')} 等共 ${items.length} ${unit}`;
}

/** 门店名为空时不加括号。 */
function hotelsSuffix(account: ExpiredAccount): string {
  return account.hotelNames.length > 0 ? `（${abbreviate(account.hotelNames, '家门店')}）` : '';
}

function accountLabel(account: ExpiredAccount): string {
  return `${channelLabel(account.channel)}「${account.accountName}」${hotelsSuffix(account)}`;
}

/**
 * 失效汇总 → 提醒。汇总为空返回 null，调用方据此收起上一条。
 *
 * ```
 * 1 个   您的美团酒店账号「YunduojiudianAI」（云朵酒店）登录已过期，请及时登录，…
 * N 个   请及时登录，避免影响价量态追齐：
 *        美团酒店「YunduojiudianAI」（A店、B店 等共 5 家门店）
 *        携程「运营商赵经理」（云朵酒店(包头机场店)）
 *        等共 4 个账号                                   ← 超过 2 个账号才有这行
 * ```
 *
 * 门店与账号都最多列 2 项，其余折成「等共 N …」—— 卡片宽度有限，全列会占满右上角。
 */
export function toCredentialExpiryNotice(
  summary: OtaCredentialExpiryScannedEvent,
): AppNotification | null {
  const { accounts } = summary;
  const [only] = accounts;
  if (only === undefined) return null;

  const base = {
    id: CREDENTIAL_EXPIRY_NOTICE_ID,
    // 红色 + 警示图标：与蓝色的更新提醒同时出现时一眼能分开。
    tone: 'error' as const,
    durationMs: NOTICE_DURATION_MS,
  };

  if (accounts.length === 1) {
    return {
      ...base,
      title: '渠道账号登录已过期',
      message: `您的${channelLabel(only.channel)}账号「${only.accountName}」${hotelsSuffix(only)}登录已过期，${CALL_TO_ACTION}`,
    };
  }

  return {
    ...base,
    title: `${accounts.length} 个渠道账号登录已过期`,
    message: [
      CALL_TO_ACTION.replace(/。$/, '：'),
      ...accounts.slice(0, MAX_LISTED).map(accountLabel),
      ...(accounts.length > MAX_LISTED ? [`等共 ${accounts.length} 个账号`] : []),
    ].join('\n'),
  };
}
