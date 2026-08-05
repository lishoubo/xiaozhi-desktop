export type OtaAccountStatus =
  | 'PENDING_LOGIN'
  | 'IN_PROGRESS'
  | 'WAITING_CAPTCHA'
  | 'BOUND'
  | 'LOGIN_FAILED'
  | 'LOGIN_EXPIRED'
  | 'HOTEL_NAME_MISMATCH'
  | 'HOTEL_NAME_AMBIGUOUS'
  | 'INIT_FAILED'
  | 'UNBOUND';

export type BoundOtaAccount = Readonly<{
  id: number;
  hotelId: number;
  orgId: number;
  source: string;
  username: string;
  otaHotelId: string | null;
  otaHotelName: string | null;
  status: OtaAccountStatus | string;
  lastLoginAt: string | null;
  lastInitAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
  bindError: string | null;
  bindExtra: string | null;
}>;

export type ManagedHotel = Readonly<{
  id: number;
  name: string;
  city: string;
  address: string;
  otaAccounts: readonly BoundOtaAccount[];
}>;

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

export function getOtaAccountBindDetails(bindExtra: string | null): OtaAccountBindDetail[] {
  if (!bindExtra?.trim()) return [];

  try {
    const parsed: unknown = JSON.parse(bindExtra);
    if (!isRecord(parsed)) return [];

    const details: OtaAccountBindDetail[] = [];
    const merchantGroupId = readNonBlankString(parsed.merchantGroupId);
    const otaPartnerId = readNonBlankString(parsed.otaPartnerId);
    const loginMethod = readNonBlankString(parsed.loginMethod);
    const loginPhone = readNonBlankString(parsed.loginPhone);

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
  } catch {
    return [];
  }
}
