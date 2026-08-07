/**
 * 三渠道统一的酒店探测接口。触发机制、去重规则、落库逻辑对三个渠道完全一致
 * （见 `ota-hotel-prob-feature.ts`），差异只体现在各渠道 `probe()` 内部怎么拿到
 * 酒店数据——携程不碰页面，直接解析 `credential.credentialExtra`；抖音/美团真的
 * 操作页面。见
 * openspec/changes/split-ota-hotel-prob-feature/design.md 决策 3。
 */
import type { WebContents } from 'electron';
import type { OtaCredential } from '../../../domain/ota-credential';
import type { JsonObject } from '../../../domain/json';
import type { OtaHotelId } from '../../../domain/identity';

export type ProbedHotel = Readonly<{
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
}>;

export type HotelProbeOutcome =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'found'; hotels: readonly ProbedHotel[] }>;

export interface HotelProbe {
  isProbeableUrl(url: string): boolean;
  probe(credential: OtaCredential, webContents: WebContents): Promise<HotelProbeOutcome>;
}
