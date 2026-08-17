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

/**
 * 占着「该酒店 + 该渠道」绑定位的渠道集合 —— 新增绑定时要把它们排除掉。
 *
 * ⚠️ **没有 `otaHotelId` 的脏记录照样占位**，别想着放行它。远端的判据只看
 * 「酒店 + 渠道」，既不看门店也不看 status（`AppOtaBindAppService.findActiveBinding`），
 * 本地放宽只会让用户一路走到提交那步才被远端拒 —— 比一开始就不给入口更糟。
 * 这类记录的修复要等服务端支持在 PUT 上补写门店，见
 * `openspec/changes/reauth-intent-and-legacy-binding/rms-server-需求-补全无门店绑定.md`。
 */
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
export type OtaAccountAction = 'login' | 'backfill-hotel';
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
 * 绑定不完整：远端记录在，却没有 OTA 门店。
 *
 * 这时说什么「登录已失效」都是错的 —— 一条没有门店的绑定压根没建成，重新登录也
 * 无从恢复（两个核对锚点都没有：既不知道账号，也不知道门店）。唯一的出路是重新
 * 走一遍绑定，或者解绑掉这条脏记录。
 */
const INCOMPLETE_BINDING_PRESENTATION: OtaAccountPresentation = {
  label: '未绑定成功',
  // 修复走 `backfill-hotel`：前半段与绑定一致（登录、探测、用户选门店），后半段
  // 调 `PUT /ota-accounts/{id}` 把门店补上，**不必解绑**。不能走新增绑定——远端按
  // 「酒店+渠道」占位，这条记录本身就占着位，POST 一定被拒。
  description: '这条绑定没有关联到门店，重新选择门店即可修复',
  tone: 'error',
  action: 'backfill-hotel',
};

/**
 * 绑定状态 → 展示。按用户能做什么分档，而不是逐个映射服务端的九个取值：
 *
 * - 没有 `otaHotelId` —— 绑定不完整，给重新绑定入口（**优先于 status 判断**）
 * - `BOUND` —— 可用
 * - `LOGIN_FAILED` / `LOGIN_EXPIRED` / `UNBOUND` —— 给重新登录入口
 * - 其余（含 `PENDING_LOGIN`、初始化失败三兄弟、未知取值）—— 提示联系管理员
 *
 * ⚠️ **门店判断必须排在 status 之前**：远端的 status 只描述登录态，不表达「这条
 * 绑定完不完整」。一条 `LOGIN_EXPIRED` 却没有门店的记录，远端说的是「登录过期」，
 * 但用户按登录去修永远修不好 —— 正确的答案是重新绑定。
 *
 * 服务端取值清单见 `AppOtaAccountResponse` 的 `STATUS_*` 常量。
 */
export function getOtaAccountPresentation(
  status: string,
  /**
   * 缺省 `undefined` = **调用方没提供门店信息**，按 status 正常判断；显式传 null
   * 或空串才是「这条绑定没有门店」。两者必须分开：默认成「没有门店」会让所有只传
   * status 的调用方（含既有测试）一律显示「未绑定成功」。
   */
  otaHotelId?: string | null,
): OtaAccountPresentation {
  // 正常绑定一定有 otaHotelId（已与用户确认）；显式为空即脏数据。
  if (otaHotelId !== undefined && (otaHotelId === null || otaHotelId.trim() === '')) {
    return INCOMPLETE_BINDING_PRESENTATION;
  }
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

/**
 * 「上次刷新」的时刻文案。
 *
 * 刻意用绝对时刻而不是「刚刚 / N 分钟前」：这页每次刷新都真打远端，看的人要判断
 * 手上这份新不新，"刚刚"到底是多久说不清，`19:54` 能直接跟自己的表对上。
 *
 * 跨天时补上日期前缀——只显示 `19:54` 会让昨天的数据看着像刚拉的。
 */
export function formatLastRefreshedAt(refreshedAt: Date, now: Date): string {
  const time = refreshedAt.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const sameDay =
    refreshedAt.getFullYear() === now.getFullYear() &&
    refreshedAt.getMonth() === now.getMonth() &&
    refreshedAt.getDate() === now.getDate();

  if (sameDay) return time;

  const date = refreshedAt.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  return `${date} ${time}`;
}
