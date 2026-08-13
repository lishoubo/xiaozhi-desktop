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
   * 要拦的端点：key 是 `endpointId`（渠道内自定义，会原样带进上报体），
   * value 是用于匹配 URL 的路径片段。
   *
   * 用 Map 而非单个常量，是为了「一个渠道有多个端点」这个**当下的事实**：抖音改价
   * 与改房态房量是两个不同端点，走同一套拦截机制。
   *
   * ⚠️ 叫 `watched` 而不是 `save`：**拦下来的不都是保存**。美团的 `calcPriceV2` 是用户
   * 填写时页面自己发的试算请求，拦它是为了拿「改后价 + 原价」当上下文（请求体里只有
   * 「+2 元」这种相对操作，算不出绝对价），它本身不构成一次改价。哪个端点是保存、哪个是
   * 素材，由 `parse` 的返回值区分 —— 机制层不认识这个差别。
   */
  readonly watchedEndpoints: ReadonlyMap<string, string>;

  /**
   * 这次保存渠道那边真的成功了吗。
   *
   * 必须由适配器判断，不能写在机制层：抖音看 `BaseResp.StatusCode === 0`，其余渠道的
   * 响应形状完全不同。这一步是防脏数据的关键——渠道自己都没保存成功却上报，会让 RMS
   * 按一个不存在的价格去跟价，造成渠道间价格不一致。
   *
   * ## ⚠️ 为什么要给 `endpointId`：同一渠道的不同端点，响应形状可以完全不同
   *
   * 携程三个端点两两不同，且**光看响应体分不出自己在判哪一个**：
   *
   * ```
   * batchsetroomprice            {code:200, data:{roomPriceSetResults:[{resultCode}]}}
   * setRCRoomPrice               {resStatus:{rcode}, ResponseStatus:{Ack}}
   * setbatchroombookablestatus   {code:200, returnCode:"200", data:null}  ← 没有内层明细
   * ```
   *
   * 房态成功是「`code:200` + 用不了的 `data`」，改价响应结构异常也是「`code:200` + 用不了的
   * `data`」—— 靠形状自辨必然把房态的每一次成功都判成失败，而失效方式是**静默漏报**：
   * 日志上与「用户根本没改房态」一模一样。
   *
   * `endpointId` 在机制层本来就算好了（`amount-save-capture.ts` 的 `matchEndpoint`），
   * 传下来零成本。渠道只有单一端点、或响应形状本就一致时（抖音、美团）忽略这个参数即可。
   */
  isSuccessful(responseBody: string, endpointId: string): boolean;

  /**
   * 把原始事实解读成上报体。
   *
   * @param context 同一个页面会话里，本适配器上一次交出的 `{ kind: 'context' }` 内容；
   *                没有则为 `null`。机制层只负责**存与喂**，不解读其内容 —— 存什么、
   *                怎么用全在适配器自己手里。
   *
   * 三种返回值：
   * - `{ kind: 'report' }`  —— 这是一次真实的价量态改动，上报
   * - `{ kind: 'context' }` —— 不是改动，但内容留着给同页面后续的 parse 用（美团 `calcPriceV2`）
   * - `null`                —— 丢弃。缺关键定位字段（定位不了酒店的上报对 RMS 毫无意义），
   *                            或这次拦到的根本不该上报（美团 `createFlag: false` 的预检）
   */
  parse(observed: AmountSaveObserved, context: JsonObject | null): AmountParseResult | null;
}

/** 见 `AmountChangeAdapter.parse`。 */
export type AmountParseResult =
  | Readonly<{ kind: 'report'; report: OtaAmountChangeObserved }>
  | Readonly<{ kind: 'context'; context: JsonObject }>;
