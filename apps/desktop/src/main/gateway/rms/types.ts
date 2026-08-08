/**
 * desktop 对远端 RMS 的窄接口要求（domain port，无实现）。
 *
 * 两个 Gateway 按远端聚合边界拆分：酒店与 OTA account 的生命周期和权限不同，
 * 绑定操作需要携带渠道 Cookie 快照，不应该出现在普通酒店 CRUD 接口上。
 * 本期由 main composition root 注入有状态 mock；真实接入时替换成调用
 * `apps/server` adapter 的实现，接口不变。
 */
import type { ChannelId } from '../../../domain/identity';
import type { JsonObject } from '../../../domain/json';
import type { RmsHotel, RmsHotelCreateInput } from '../../../domain/rms-hotel';
import type { RmsOtaAccount } from '../../../domain/rms-ota-account';

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

export interface RmsOtaAccountGateway {
  listOtaAccounts(): Promise<readonly RmsOtaAccount[]>;
  bind(input: RmsOtaAccountBindInput): Promise<RmsOtaAccount>;
  unbind(otaAccountId: number): Promise<void>;
}
