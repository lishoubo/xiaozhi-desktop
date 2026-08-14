/**
 * 本地登录凭证在「新增绑定账号」/「重新登录」弹窗里的展示形态。
 *
 * 两个弹窗回答的是同一个问题——**「这一行到底是哪个账号」**。用户要在几个长得很像
 * 的条目之间做选择，只给一个名字不够：同一渠道下同名账号、或者压根没有名字（美团
 * 的 extra 里既没有 `hotelName` 也没有 `name`）都会退化成一串数字 ID。
 *
 * 所以每行拆成两层：`title` 认人，`details` 佐证。`details` 的字段随渠道不同：
 *
 * | 渠道 | 来源字段 | 上屏 |
 * |---|---|---|
 * | 携程 | `userName` / `masterHotelId` / `hotelName`（老记录 `hotelId`） | 酒店 ID、酒店 |
 * | 抖音 | `loginId` / `name` / `roleName` / `roleType` | 登录 ID、角色 |
 * | 美团 | `partnerId` / `login` / `accountType` / `accountStatus` / `maskedPhone` | 商家 ID、登录名、手机号 |
 *
 * 携程的 `title` 取 `userName`（账号名）而不是 `hotelName`（酒店名）：一个账号可以
 * 管多家门店，用门店名认账号在多店场景下会串。酒店退到 `details` 里当佐证。
 *
 * **数字码不上屏**：抖音 `roleType`、美团 `accountType` / `accountStatus` 是渠道内部
 * 编码（`roleName` 已经是它的可读版本），把 `2` 摆给运营看只是噪音。`identitySource`
 * 同理，是抓取方式的内部标记，不是账号信息。
 */
import type { OtaCredentialDto } from '../../shared/browser';

export type CredentialDetail = Readonly<{ label: string; value: string }>;

export type CredentialPresentation = Readonly<{
  /** 认人用的主标题，永不为空（层层兜底到本地凭证 ID）。 */
  title: string;
  /** 佐证信息，按渠道展开；无可展示字段时为空数组。 */
  details: readonly CredentialDetail[];
}>;

function readNonBlankString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  // 渠道 extra 里的 ID 有时是数字（抖音 loginId 允许 number），别因为类型漏掉它。
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function pushDetail(details: CredentialDetail[], label: string, value: unknown): void {
  const normalized = readNonBlankString(value);
  if (normalized) details.push({ label, value: normalized });
}

/**
 * 主标题：优先渠道给的可读名，退到渠道账号 ID，最后才是本地凭证 ID。
 *
 * 最后一档几乎不会出现（渠道身份抓取失败时凭证本身就建不起来），留着只为保证这一
 * 行不会渲染成空白——空白行没法选，比一串 UUID 更糟。
 */
function credentialTitle(credential: OtaCredentialDto): string {
  const extra = credential.credentialExtra;
  return (
    readNonBlankString(extra?.userName) ?? // 携程
    readNonBlankString(extra?.name) ??
    readNonBlankString(extra?.login) ??
    // 携程老记录没有 `userName`，只好退回酒店名。**必须排在 `userName` 之后**，
    // 否则新记录（两个字段都有）会一律显示成酒店名，等于没改口径。
    readNonBlankString(extra?.hotelName) ??
    credential.channelAccountId ??
    credential.id
  );
}

export function credentialPresentation(credential: OtaCredentialDto): CredentialPresentation {
  const extra = credential.credentialExtra;
  const details: CredentialDetail[] = [];

  // 渠道账号 ID 三个渠道都有，且是与远端绑定记录对齐的那个标识——排在最前。
  pushDetail(details, '账号 ID', credential.channelAccountId);

  // 各渠道特有字段。键名不重叠，不必按 channel 分支：有就展示，没有自然跳过。
  // 携程：新记录 `masterHotelId`，老记录 `hotelId`，两者不会同时出现在同一条上。
  pushDetail(details, '酒店 ID', extra?.masterHotelId ?? extra?.hotelId);
  // 账号名已经是 title，这里补酒店名——多店账号下「这个账号当前在哪家店」是有效佐证。
  pushDetail(details, '酒店', extra?.hotelName); // 携程
  pushDetail(details, '登录 ID', extra?.loginId); // 抖音
  pushDetail(details, '角色', extra?.roleName); // 抖音
  pushDetail(details, '商家 ID', extra?.partnerId); // 美团
  pushDetail(details, '登录名', extra?.login); // 美团
  pushDetail(details, '手机号', extra?.maskedPhone); // 美团

  return { title: credentialTitle(credential), details };
}
