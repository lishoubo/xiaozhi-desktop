/**
 * 渠道适配器契约。三个渠道（携程/抖音/美团）各提供一份实现，由
 * `registry.ts` 组装后注入给 services —— services 只认这里的接口，
 * 对具体渠道一无所知。
 *
 * 这些接口就近定义在 `channels/` 而非单独的 ports 目录：它们是渠道适配器
 * 自身的契约，多实现是**当下的事实**（三个渠道），不是"将来可能换"。
 */
import type { WebContents } from 'electron';
import type { ChannelId, OtaHotelId } from '../ids';
import type { JsonObject } from '../../shared/types/json';
import type { OtaCredential } from '../../shared/types/ota-credential';

/**
 * 判断登录标签页的 URL 是否已经离开登录页——命中即视为登录成功，触发探测。
 * 见 `cookie-login-account-discovery/design.md` 决策 8。渠道未注册 matcher
 * 时不参与 URL 触发。
 */
export interface LoginUrlMatcher {
  readonly channel: ChannelId;
  isPastLogin(url: string): boolean;
}

export type ProbedHotel = Readonly<{
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
}>;

export type HotelProbeOutcome =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'found'; hotels: readonly ProbedHotel[] }>;

/**
 * 三渠道统一的酒店探测接口。探测是**无副作用的查询**：只产出候选，不落库、
 * 不去重、不跳过——酒店信息仅在用户从候选中选定后才保存（见
 * `ota-hotel-stores-hotel-info-only/design.md` 决策 3、4）。触发机制对三个渠道
 * 一致（见 `channels/hotel-probe-dispatcher.ts`），差异只体现在各渠道 `probe()`
 * 内部怎么拿到酒店数据——携程不碰页面，直接解析 `credential.credentialExtra`；
 * 抖音/美团真的操作页面。见 `split-ota-hotel-prob-feature/design.md` 决策 3。
 */
export interface HotelProbe {
  isProbeableUrl(url: string): boolean;
  probe(credential: OtaCredential, webContents: WebContents): Promise<HotelProbeOutcome>;
}
