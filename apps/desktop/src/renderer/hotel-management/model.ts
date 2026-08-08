import type { RmsOtaAccountDto } from '../../shared/hotel-management';
import { isActiveBinding } from './account-status';

/**
 * 这家酒店已经占用了哪些渠道的绑定位。
 *
 * 远端规则是「同一酒店 + 同一渠道只能有一个活跃绑定」，所以发起绑定时要按**渠道
 * 整体**排除，不是只排除已绑定的那一个账号——同渠道的其他账号选了也会被远端拒绝。
 */
/**
 * 「这次绑定需要先解绑吗」——从「重新登录」点新登录账号时，该酒店在本渠道已经有一
 * 条绑定；换成别的门店远端必拒（只允许一个活跃绑定），所以在确认前就要拦住。
 *
 * `replacing` 为 null 表示这不是替换场景（普通新增绑定），永远不需要解绑。
 * 选中的就是原来那家门店时也不需要——那等于重新绑同一家，远端不会冲突。
 */
export function requiresUnbindBeforeBinding(
  replacing: string | null,
  selectedOtaHotelId: string | undefined,
): boolean {
  if (replacing === null || selectedOtaHotelId === undefined) return false;
  return selectedOtaHotelId !== replacing;
}

/**
 * 列表翻页的派生值。`safePage` 会把越界页码夹回有效范围——删到最后一页空了、或
 * 重新加载后总数变少时，页码若不回退就会停在空白页。
 */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): Readonly<{ safePage: number; totalPages: number; pageItems: readonly T[] }> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, Math.trunc(page)), totalPages);
  return {
    safePage,
    totalPages,
    pageItems: items.slice((safePage - 1) * pageSize, safePage * pageSize),
  };
}

export function boundChannelsOfHotel(accounts: readonly RmsOtaAccountDto[]): ReadonlySet<string> {
  return new Set(
    accounts.filter((account) => isActiveBinding(account.status)).map((account) => account.source),
  );
}

export function groupOtaAccountsByHotelId(
  otaAccounts: readonly RmsOtaAccountDto[],
): ReadonlyMap<number, readonly RmsOtaAccountDto[]> {
  const grouped = new Map<number, RmsOtaAccountDto[]>();
  for (const account of otaAccounts) {
    const existing = grouped.get(account.hotelId);
    if (existing) {
      existing.push(account);
    } else {
      grouped.set(account.hotelId, [account]);
    }
  }
  return grouped;
}

export type OtaAccountAction = 'login' | 'retry' | 'resolve';
export type OtaAccountTone = 'healthy' | 'warning' | 'progress' | 'error' | 'neutral';

export type OtaAccountPresentation = Readonly<{
  label: string;
  description: string;
  tone: OtaAccountTone;
  action: OtaAccountAction | null;
}>;

export type OtaAccountBindDetail = Readonly<{ label: string; value: string }>;

const STATUS_PRESENTATIONS: Readonly<Record<string, OtaAccountPresentation>> = {
  BOUND: {
    label: '已绑定',
    description: '账号连接正常',
    tone: 'healthy',
    action: null,
  },
  PENDING_LOGIN: {
    label: '待登录',
    description: '完成登录后即可绑定',
    tone: 'warning',
    action: 'login',
  },
  IN_PROGRESS: {
    label: '绑定中',
    description: '正在获取酒店信息',
    tone: 'progress',
    action: null,
  },
  WAITING_CAPTCHA: {
    label: '等待验证码',
    description: '请继续完成平台验证',
    tone: 'warning',
    action: 'login',
  },
  LOGIN_FAILED: {
    label: '登录失败',
    description: '上次登录未成功，请重试',
    tone: 'error',
    action: 'login',
  },
  LOGIN_EXPIRED: {
    label: '登录已失效',
    description: '登录凭证已过期，请重新登录',
    tone: 'error',
    action: 'login',
  },
  HOTEL_NAME_MISMATCH: {
    label: '酒店不匹配',
    description: '平台酒店名称与当前酒店不一致',
    tone: 'error',
    action: 'resolve',
  },
  HOTEL_NAME_AMBIGUOUS: {
    label: '待确认酒店',
    description: '平台存在多家同名酒店',
    tone: 'warning',
    action: 'resolve',
  },
  INIT_FAILED: {
    label: '初始化失败',
    description: '酒店信息同步未完成',
    tone: 'error',
    action: 'retry',
  },
  UNBOUND: {
    label: '已解绑',
    description: '此账号已解除绑定',
    tone: 'neutral',
    action: 'login',
  },
};

const UNKNOWN_STATUS: OtaAccountPresentation = {
  label: '状态待确认',
  description: '暂时无法识别此账号状态',
  tone: 'neutral',
  action: null,
};

export function getOtaAccountPresentation(status: string): OtaAccountPresentation {
  return STATUS_PRESENTATIONS[status] ?? UNKNOWN_STATUS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonBlankString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function getOtaAccountBindDetails(
  bindExtra: Readonly<Record<string, unknown>> | null,
): OtaAccountBindDetail[] {
  if (!bindExtra || !isRecord(bindExtra)) return [];

  const details: OtaAccountBindDetail[] = [];
  const merchantGroupId = readNonBlankString(bindExtra.merchantGroupId);
  const otaPartnerId = readNonBlankString(bindExtra.otaPartnerId);
  const loginMethod = readNonBlankString(bindExtra.loginMethod);
  const loginPhone = readNonBlankString(bindExtra.loginPhone);

  if (merchantGroupId) details.push({ label: '抖音商户 ID', value: merchantGroupId });
  if (otaPartnerId) details.push({ label: '美团 Partner ID', value: otaPartnerId });
  if (loginMethod) {
    details.push({
      label: '登录方式',
      value:
        loginMethod === 'SMS'
          ? '短信验证码'
          : loginMethod === 'PASSWORD'
            ? '账号密码'
            : loginMethod,
    });
  }
  if (loginPhone) details.push({ label: '登录手机号', value: loginPhone });

  return details;
}
