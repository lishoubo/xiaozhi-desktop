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

  /**
   * **旁听端点**：拦到了但既不判成败、也不产上报体的那些。
   *
   * 返回 `true` 表示这个 `endpointId` 由本钩子独占处理 —— 机制层把响应体交给
   * `onAuxiliaryResponse` 后就结束，**不会**再走 `isSuccessful` / `parse`。
   *
   * 当前唯一的用途是携程批量任务的状态查询（`queryMainTaskInfoForDisplay`）：页面保存后
   * 自己轮询它，用来判断异步写入何时完成，本身不构成一次改动。
   *
   * ⚠️ 必须与保存端点**显式分开**，不能让它落进 `isSuccessful` 的形状自辨 —— 那个端点的
   * 响应信封（`resStatus.rcode`）与改价新模块同构，会被判成一次成功的改价并产出上报体。
   * 与本文件其他几处「判据按端点钉死」是同一条原则。
   */
  isAuxiliaryEndpoint?(endpointId: string): boolean;

  /** 旁听端点的响应到了。仅在 `isAuxiliaryEndpoint` 返回 `true` 时调用。 */
  onAuxiliaryResponse?(endpointId: string, responseBody: string): void;

  /**
   * **读端点**：用户浏览页面时页面自己发的价量态**查询**请求。
   *
   * 返回 `true` 表示这个 `endpointId` 是读接口 —— 机制层把响应体交给 `onReadResponse`
   * 后就结束，**不会**再走 `isSuccessful` / `parse`。分流位置与 `isAuxiliaryEndpoint`
   * 相同，两者都是「拦到了但不构成一次改动」。
   *
   * ## 为什么复用同一条 CDP 连接，而不是新建一个 capture
   *
   * `webContents.debugger` 是**独占**的：已经 attach 时再 attach 会被拒绝。而改价监听
   * 早就在同一个页面上 attach 了（携程 `/ebkovsroom/inventory` 既是改价页也是查询页），
   * 另起一个 capture 必然静默失效 —— 日志显示「监听已启动」，实际一个请求都拦不到，
   * 与「用户根本没翻页面」长得一模一样。
   *
   * 一个页面拦多个接口本来就是既有形状（携程当前已同时拦 5 个写端点 + 1 个旁听端点），
   * 读端点只是再加一类。
   *
   * ## ⚠️ 与 `isAuxiliaryEndpoint` 的区别
   *
   * ```
   * isAuxiliaryEndpoint   拦到的是**任务状态轮询**，内容喂回适配器自己用
   * isReadEndpoint        拦到的是**价量态查询结果**，内容拿去建基线快照
   * ```
   *
   * 两者都不判成败、都不产上报体，但去向完全不同，所以是两个钩子而不是一个。
   */
  isReadEndpoint?(endpointId: string): boolean;

  /**
   * 读端点的响应到了。仅在 `isReadEndpoint` 返回 `true` 时调用。
   *
   * @param responseBody 渠道原始响应（未解析）。解析与裁剪由适配器做 —— 机制层不认识
   *        任何渠道的响应形状。
   * @returns 从响应里抽出的价量态原始行。空数组表示这次响应没有可用数据（合法结果）。
   *
   * ⚠️ 这里**只返回行，不返回格子**：格子需要 `otaHotelId`（取自登录凭证），而
   * `channels/` 被 eslint 禁止访问 `database/`。补齐在装配层做，与回读同一手法。
   */
  onReadResponse?(endpointId: string, responseBody: string): readonly JsonObject[];
}

/** 见 `AmountChangeAdapter.parse`。 */
export type AmountParseResult =
  | Readonly<{ kind: 'report'; report: OtaAmountChangeObserved }>
  | Readonly<{ kind: 'context'; context: JsonObject }>;

/** 回读失败的原因。403 与登录失效**必须分开** —— 见 `InventoryReadback`。 */
export type ReadbackFailureReason =
  | 'COOKIE_EXPIRED'
  | 'FORBIDDEN'
  | 'PARSE_ERROR'
  | 'NETWORK_ERROR'
  | 'UNEXPECTED';

/**
 * 回读的结果。**三态分开，不用「空数组表示失败」**。
 *
 * ⚠️ `skipped`（这次改动不需要回读）与 `failed`（读失败了）必须区分：两者在日志里长得
 * 一样的话，排查时分不清是逻辑挡掉了还是真出错 —— 既有 watcher 在「监听被悄悄停掉」上
 * 吃过这个亏。
 *
 * ⚠️ `ok` 且 `cells` 为空是**合法结果**（该房型这些天确实没有数据），不是失败。RPA 侧
 * 曾因把「失败」当成「确实为空」而全店软删、联动房型集体不跟价。
 */
export type ReadbackOutcome =
  | Readonly<{ kind: 'ok'; report: OtaAmountChangeObserved }>
  | Readonly<{ kind: 'skipped'; reason: string }>
  | Readonly<{ kind: 'failed'; reason: ReadbackFailureReason }>;

/**
 * 房量回读能力 —— 用户在渠道后台改完房态房量后，主动读回渠道的**真实状态**。
 *
 * ## 为什么需要它
 *
 * 渠道的「增加 / 减少」是**相对操作**（携程批量页的 `remainRoomQuantityType: 11`(加) /
 * `12`(减) 只说「+2」不说基数），而写接口的响应**不回传改后状态**。所以「渠道现在到底是
 * 什么」只能主动读回来。
 *
 * ## 与 `AmountChangeAdapter` 的关系
 *
 * 这是那条链路的**下游**：消费的是 `parse` 产出的上报体，而不是原始观测。于是白捡三件事
 * —— `isSuccessful` 已判过、房型取不到时 `parse` 已返回 `null`、请求体已裁剪好。
 *
 * ## ⚠️ 只有一个方法，渠道差异全在实现里
 *
 * 「这次改动要不要回读」「回读哪些房型日期」「上报体怎么组」**全部是渠道内部的事**，
 * MUST NOT 提升到本接口上 —— 调度层（`inventory-readback-dispatcher.ts`）既不认识端点名，
 * 也不消费房型日期，它只做「按渠道取实现 → 调用 → 递出结果」。
 *
 * 没有这项能力的渠道**不注册**即可（`ChannelAdapter.inventoryReadback` 是可选字段），
 * 调度层自然跳过。加一个渠道 = 写一份实现 + `registry.ts` 加一行。
 */
export interface InventoryReadback {
  /**
   * @param report 既有链路刚产出的改动上报体（`parse` 的结果）
   * @param webContents 用户刚才操作的那个标签页 —— 回读在它的上下文里发起，由浏览器
   *        自带会话凭据，**不在主进程自行装配 cookie 串**
   */
  readback(report: OtaAmountChangeObserved, webContents: WebContents): Promise<ReadbackOutcome>;
}
