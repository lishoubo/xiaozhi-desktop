/**
 * desktop 对远端 RMS 的窄接口要求（domain port，无实现）。
 *
 * 两个 Gateway 按远端聚合边界拆分：酒店与 OTA account 的生命周期和权限不同，
 * 绑定操作需要携带渠道 Cookie 快照，不应该出现在普通酒店 CRUD 接口上。
 * 实现见同目录的 `*-gateway-http.ts`，直连 rms-server 的 `/api/v1/app/*`。
 */
import type { ChannelId } from '../../ids';
import type { OtaAmountChangeReport } from '../../../shared/types/amount-change';
import type { JsonObject } from '../../../shared/types/json';
import type { RmsHotel, RmsHotelCreateInput } from '../../../shared/types/rms-hotel';
import type { RmsOtaAccount } from '../../../shared/types/rms-ota-account';

export interface RmsHotelGateway {
  listHotels(): Promise<readonly RmsHotel[]>;
  createHotel(input: RmsHotelCreateInput): Promise<RmsHotel>;
  deleteHotel(hotelId: number): Promise<void>;
}

export type RmsOtaAccountBindInput = Readonly<{
  operationId: string;
  hotelId: number;
  source: ChannelId;
  otaHotelId: string;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
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
   * **整份**绑定上下文，不是增量：远端是整体替换 `bindExtra`，只发变化的键会把没发
   * 的键（抖音的 `merchantGroupId`、美团的 `otaPartnerId`）抹掉。调用方负责在远端
   * 现值之上合并，见 `HotelManagementService.confirmReauth`。
   */
  bindExtra: JsonObject | null;
}>;

export interface RmsOtaAccountGateway {
  listOtaAccounts(): Promise<readonly RmsOtaAccount[]>;
  bind(input: RmsOtaAccountBindInput): Promise<RmsOtaAccount>;
  unbind(otaAccountId: number): Promise<void>;
  reauthenticate(input: RmsOtaAccountReauthInput): Promise<RmsOtaAccount>;
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
