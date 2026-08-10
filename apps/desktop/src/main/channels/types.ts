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
import type { AmountSaveObserved, OtaAmountChangeObserved } from '../../shared/types/amount-change';
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
  Readonly<{ kind: 'none' }> | Readonly<{ kind: 'found'; hotels: readonly ProbedHotel[] }>;

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

/**
 * 价量态改动监听的渠道适配器 —— 这个接口是**唯一**的渠道差异落点。
 *
 * 机制部分（CDP 请求/响应配对、attach 生命周期）与渠道无关，只写一次，见
 * `amount-save-capture.ts` 与 `amount-change-watcher.ts`。加一个渠道 = 写一份这个接口的
 * 实现 + 在 `registry.ts` 加一行，机制层一行都不用动。
 *
 * 与 `HotelProbe` 的对比：那个是**主动**探测（会点菜单、等页面、有超时）；这个是**被动**
 * 旁听（只读用户自己发出的请求，绝不碰页面）。所以这里没有 `webContents` 参数——适配器
 * 只做纯粹的判断与解析，拿不到页面也就不可能操作页面。
 */
export interface AmountChangeAdapter {
  /**
   * 这个 URL 是不是「要一直监听的页面」。返回 true 才 attach CDP，离开即 detach——
   * 不是全程常驻，避免 debugger 长期挂着的开销，也避开与 `HotelProbe` 的 attach 独占冲突。
   */
  isWatchableUrl(url: string): boolean;

  /**
   * 要拦的保存端点：key 是 `endpointId`（渠道内自定义，会原样带进上报体），
   * value 是用于匹配 URL 的路径片段。
   *
   * 用 Map 而非单个常量，是为了「一个渠道有多个保存端点」这个**当下的事实**：抖音改价
   * 与改房态房量是两个不同端点，走同一套拦截机制。
   */
  readonly saveEndpoints: ReadonlyMap<string, string>;

  /**
   * 这次保存渠道那边真的成功了吗。
   *
   * 必须由适配器判断，不能写在机制层：抖音看 `BaseResp.StatusCode === 0`，其余渠道的
   * 响应形状完全不同。这一步是防脏数据的关键——渠道自己都没保存成功却上报，会让 RMS
   * 按一个不存在的价格去跟价，造成渠道间价格不一致。
   */
  isSuccessful(responseBody: string): boolean;

  /**
   * 把原始事实解读成上报体。缺关键定位字段（如酒店 ID）时返回 `null` —— 定位不了酒店的
   * 上报对 RMS 毫无意义，宁可丢弃并记日志。
   */
  parse(observed: AmountSaveObserved): OtaAmountChangeObserved | null;
}
