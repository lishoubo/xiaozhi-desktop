/**
 * desktop 对远端 RMS 的窄接口要求（domain port，无实现）。
 *
 * 两个 Gateway 按远端聚合边界拆分：酒店与 OTA account 的生命周期和权限不同，
 * 绑定操作需要携带渠道 Cookie 快照，不应该出现在普通酒店 CRUD 接口上。
 * 实现见同目录的 `*-gateway-http.ts`，直连 rms-server 的 `/api/v1/app/*`。
 */
import type { ChannelId } from '../../ids';
import type { OtaAmountChangeReport } from '../../../shared/types/amount-change';
import type { RmsHotel, RmsHotelCreateInput } from '../../../shared/types/rms-hotel';
import type { RmsOtaAccount } from '../../../shared/types/rms-ota-account';

export interface RmsHotelGateway {
  listHotels(): Promise<readonly RmsHotel[]>;
  createHotel(input: RmsHotelCreateInput): Promise<RmsHotel>;
  deleteHotel(hotelId: number): Promise<void>;
}

/**
 * 远端 `bind_extra` 里的**账号级**字段 —— 由「登录的是哪个账号」决定，同一登录凭据
 * 下的所有门店取值相同。
 *
 * 服务端按键合并（`DeskBindExtra.applyFromDesktop`），未传的键保留原值；契约外的键
 * 静默忽略。字段清单对齐 rms-server 的 `AppBindExtraRequest`。
 */
export type RmsChannelAccountFields = Readonly<{
  /**
   * 渠道账号标识（携程 `huid` / 抖音 `user_id` / 美团 `bizAcctId`）。
   *
   * **最关键的一个**：远端靠它认出「这条绑定是哪个账号建的」，也是同账号多酒店共享
   * cookie 的分组依据（缺失时刷新只更新当前一行，其余酒店仍持过期 cookie）。
   * RMS 后台绑定的历史记录没有它，desktop 的「按门店重认」流程负责补上。
   */
  channelAccountId?: string;
  /**
   * 人类可读账号名（携程 `userName` / 抖音 `name` / 美团 `login`），仅供展示与排查。
   * 与门店无关，同账号下各门店相同。
   */
  channelAccountName?: string;
}>;

/**
 * 远端 `bind_extra` 里的**门店级**字段 —— 由「绑的是哪家门店」决定。
 *
 * ⚠️ **同一个账号下，每家门店的取值可能不同**（cookie 共用不代表这些参数共用）。
 * 所以只有在**用户当场确认了是哪家门店**时才可信 —— 也就是只有绑定流程能写它们。
 * 重新登录不确认门店，探测到的值取自当时的页面上下文，未必是这条绑定该用的；写错
 * 会让 RPA worker 拿着错的参数去跑，比不写更糟。
 *
 * 这条约束由类型保证：`RmsOtaAccountReauthInput.bindExtra` 不接受这两个字段。
 */
export type RmsChannelHotelFields = Readonly<{
  /** 抖音商户 group id，服务端 `DouyinRpaPayloadCompositor` 读进 worker payload。 */
  merchantGroupId?: string;
  /**
   * 美团**门店级** partnerId，服务端 `MeituanRpaPayloadCompositor` 读进 worker payload。
   * 注意不是 desktop `credentialExtra.partnerId`（账号级）——那是另一个值。
   */
  otaPartnerId?: string;
}>;

/**
 * 绑定：用户从候选门店里当场选定了一家，**两类字段都可信**，一并写入。
 */
export type RmsOtaAccountBindInput = Readonly<{
  operationId: string;
  hotelId: number;
  source: ChannelId;
  otaHotelId: string;
  otaHotelName: string | null;
  bindExtra: (RmsChannelAccountFields & RmsChannelHotelFields) | null;
  cookies: readonly RmsCookieSnapshotEntry[];
}>;

export type RmsCookieSnapshotEntry = Readonly<{
  domain: string;
  name: string;
  value: string;
}>;

/**
 * 只换登录凭证，**不动门店关系**——所以 `otaHotelId`/`hotelId` 不在参数里：类型上
 * 就保证这次调用改不了绑定的是哪家店。
 *
 * 不能复用 `bind()`：它有「同酒店+同渠道已存在活跃绑定」的拒绝规则，而挡住的正是
 * 要修的那条记录。也不做「先 unbind 再 bind」——中间失败会把一条只是过期的绑定变成
 * 没有绑定，比原状态更糟。
 */
export type RmsOtaAccountReauthInput = Readonly<{
  operationId: string;
  otaAccountId: number;
  cookies: readonly RmsCookieSnapshotEntry[];
  /**
   * **只能带账号级字段**，门店级的传不进来——类型即约束。
   *
   * 为什么：这个调用不确认门店。同一账号下各门店的 `merchantGroupId` /
   * `otaPartnerId` 可能不同，此刻拿到的值取自登录时的页面上下文，未必是这条绑定
   * 该用的；写进去会让 RPA 拿着错参数跑，比不写更糟。
   *
   * 只发增量即可：服务端按键合并，本次没传的键保留库里原值。
   */
  bindExtra: RmsChannelAccountFields | null;
}>;

/**
 * 修复「`otaHotelId` 为空」的历史绑定 —— 把门店补上，不解绑。
 *
 * 与 `reauthenticate` 打同一个 HTTP 端点（`PUT /ota-accounts/{id}`）但语义不同，
 * 故单列一个类型而不是给 reauth 加可选字段：
 *
 * ```
 * reauthenticate   登录态坏了 → 只换 cookie + 账号身份，门店关系不动
 * backfillHotel    绑定不完整 → 用户重新选定门店 → 把门店补上
 * ```
 *
 * 前半段与绑定流程一致（开标签页 → 登录 → 探测 → 用户选一家），所以**门店是当场
 * 确认过的**，`bindExtra` 两类字段都可信 —— 这是它与 reauth 的关键差别。
 * 后半段不能走 `bind()`：那条路会被「已存在活跃绑定」拒，挡住的正是要修的这条。
 *
 * 服务端规则（rms-server `app-ota-binding-backfill-hotel/api.md`）：
 *
 * - **两字段成对**：这里都设为必填，类型上就不可能只传其一（服务端只传其一会 400）
 * - **只补不改**：库里为空才写入；已有值且不同 → 400；相同 → 幂等通过。
 *   换门店仍须解绑重绑，这个端点不给旁路
 * - 同酒店同渠道另一条绑定已占用该门店 → 409（低频防御性错误）
 */
export type RmsOtaAccountBackfillHotelInput = Readonly<{
  operationId: string;
  otaAccountId: number;
  cookies: readonly RmsCookieSnapshotEntry[];
  otaHotelId: string;
  otaHotelName: string;
  bindExtra: (RmsChannelAccountFields & RmsChannelHotelFields) | null;
}>;

export interface RmsOtaAccountGateway {
  listOtaAccounts(): Promise<readonly RmsOtaAccount[]>;
  bind(input: RmsOtaAccountBindInput): Promise<RmsOtaAccount>;
  unbind(otaAccountId: number): Promise<void>;
  reauthenticate(input: RmsOtaAccountReauthInput): Promise<RmsOtaAccount>;
  backfillHotel(input: RmsOtaAccountBackfillHotelInput): Promise<RmsOtaAccount>;
}

/**
 * 上报「用户在渠道后台手工改了价量态」。RMS 收到后自己反查绑定、展开日期×房型、决定跟哪些
 * 渠道的价 —— desktop 只当探针。
 *
 * 单独一个 Gateway 而不是并进上面两个：这条链路的触发方是浏览器里的用户操作（不是 UI 上的
 * 某个按钮），失败处理也不同（无人在等结果，失败只能记日志），跟酒店/账号的 CRUD 不是一类。
 */
export interface RmsAmountChangeGateway {
  reportAmountChange(report: OtaAmountChangeReport): Promise<void>;
}
