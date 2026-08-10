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

/**
 * 用户能在客户端自己完成的动作。只有「重新登录」一种——初始化失败、酒店不匹配
 * 这类状态刷 cookie 解决不了，一律指向管理员而不给自助入口。
 */
export type OtaAccountAction = 'login';
export type OtaAccountTone = 'healthy' | 'warning' | 'progress' | 'error' | 'neutral';

export type OtaAccountPresentation = Readonly<{
  label: string;
  description: string;
  tone: OtaAccountTone;
  action: OtaAccountAction | null;
}>;

export type OtaAccountBindDetail = Readonly<{ label: string; value: string }>;

/**
 * 用户能自己解决的状态——只有这三个给「重新登录」入口。
 *
 * 其余状态要么是登录成功之后卡在初始化环节（重新登录解决不了），要么是 RPA
 * 正在跑（重复提交会撞唯一键或打断流程），都不该让用户自助操作。
 */
const RECOVERABLE_BY_LOGIN: Readonly<Record<string, string>> = {
  LOGIN_FAILED: '上次登录未成功，请重新登录',
  LOGIN_EXPIRED: '登录凭证已过期，请重新登录',
  UNBOUND: '此账号已解除绑定，可重新登录绑定',
};

/** 后端流程进行中：不是错误，等它跑完即可。 */
const IN_FLIGHT_STATUSES: readonly string[] = ['IN_PROGRESS', 'WAITING_CAPTCHA'];

const BOUND_PRESENTATION: OtaAccountPresentation = {
  label: '绑定成功',
  description: '账号连接正常',
  tone: 'healthy',
  action: null,
};

const IN_FLIGHT_PRESENTATION: OtaAccountPresentation = {
  label: '处理中',
  description: '登录流程进行中，请稍候',
  tone: 'progress',
  action: null,
};

/**
 * 兜底档。未知状态也归到这里而不是「状态待确认」：服务端新增的取值多半也是
 * 异常，与其让用户对着一个看不懂的标签干等，不如直接指向管理员。
 */
const BINDING_ERROR_PRESENTATION: OtaAccountPresentation = {
  label: '绑定错误',
  description: '请联系管理员',
  tone: 'error',
  action: null,
};

/**
 * 绑定状态 → 展示。按用户能做什么分三档，而不是逐个映射服务端的九个取值：
 *
 * - `BOUND` —— 可用
 * - `LOGIN_FAILED` / `LOGIN_EXPIRED` / `UNBOUND` —— 给重新登录入口
 * - 其余（含 `PENDING_LOGIN`、初始化失败三兄弟、未知取值）—— 提示联系管理员
 *
 * 服务端取值清单见 `AppOtaAccountResponse` 的 `STATUS_*` 常量。
 */
export function getOtaAccountPresentation(status: string): OtaAccountPresentation {
  if (status === 'BOUND') return BOUND_PRESENTATION;

  const recoverable = RECOVERABLE_BY_LOGIN[status];
  if (recoverable) {
    return {
      label: status === 'UNBOUND' ? '已解绑' : '登录已失效',
      description: recoverable,
      tone: status === 'UNBOUND' ? 'neutral' : 'error',
      action: 'login',
    };
  }

  if (IN_FLIGHT_STATUSES.includes(status)) return IN_FLIGHT_PRESENTATION;

  return BINDING_ERROR_PRESENTATION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonBlankString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * 展示 `bindExtra` 里的绑定上下文——**只回答「这条绑定用的是哪个账号」**。
 *
 * 字段清单以 rms-server 的 `AppBindExtraResponse` 为准（五个字段），但并非全部
 * 上屏：
 *
 * - `channelAccountName` / `channelAccountId` —— 账号身份，展示
 * - `bindSource` —— 区分桌面端自绑还是后台绑，出问题时知道该找谁，展示
 * - `merchantGroupId`（抖音）/ `otaPartnerId`（美团）—— **不展示**。它们是绑定与
 *   更新时随请求送给远端、给 RPA worker 用的渠道参数，运营既看不懂也用不上，
 *   摆在卡片上只是噪音
 *
 * 契约外字段一律忽略：`loginMethod` / `loginPhone` 是 RPA 账密绑定的内部细节，
 * 服务端不回吐（`loginPhone` 还是手机号），desktop 也不展示。
 */
export function getOtaAccountBindDetails(
  bindExtra: Readonly<Record<string, unknown>> | null,
): OtaAccountBindDetail[] {
  // 整条 bindExtra 缺失是后台绑定最典型的样子，不是数据异常——照常按空对象走下去，
  // 让「绑定来源」仍然落到 RMS 这一档。
  const extra = isRecord(bindExtra) ? bindExtra : {};

  const details: OtaAccountBindDetail[] = [];
  const channelAccountName = readNonBlankString(extra.channelAccountName);
  const channelAccountId = readNonBlankString(extra.channelAccountId);

  if (channelAccountName) details.push({ label: '账号名称', value: channelAccountName });
  if (channelAccountId) details.push({ label: '账号 ID', value: channelAccountId });
  details.push({ label: '绑定来源', value: describeBindSource(extra.bindSource) });

  return details;
}

/**
 * `bindSource` → 展示文案。
 *
 * **缺失即 RMS 绑定**：服务端只在 desktop 绑定时写入 `DESKTOP`，后台绑的记录压根
 * 没有这个字段（乃至整个 `bindExtra` 都没有），所以"没标来源"本身就是一种来源，
 * 不是数据缺陷。
 */
function describeBindSource(raw: unknown): string {
  const bindSource = readNonBlankString(raw);
  if (!bindSource) return 'RMS 绑定';

  const normalized = bindSource.toUpperCase();
  if (normalized === 'DESKTOP') return '桌面端';
  if (normalized === 'RMS') return 'RMS 绑定';
  // 未知来源原样显示：编不出的名字不如让运营看到真实值，便于反馈排查。
  return bindSource;
}
