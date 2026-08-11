/**
 * 价量态改动监控的跨层契约。
 *
 * 与 `HotelProbe` 那条链路的根本差异：探测是 **intent 触发、一次性、会操作页面**；
 * 监控是 **URL 触发、常驻监听、绝不碰页面**——我们只旁听用户自己发出的保存请求，
 * 不注入脚本、不改请求、不替用户点任何东西。
 *
 * 数据流：
 * ```
 * 渠道页面的保存请求
 *   → AmountSaveObserved      （机制层产出的原始事实，尚未按渠道解读）
 *   → OtaAmountChangeObserved （渠道适配器解读后的上报体，缺 id 与时间）
 *   → OtaAmountChangeReport   （service 层补上 operationId/observedAt，发给 RMS）
 * ```
 */
import type { ChannelId } from './ids';
import type { JsonObject } from './json';

/**
 * 机制层（`channels/amount-save-capture.ts`）配对完 CDP 请求/响应后产出的**原始事实**。
 * 这一层不认识任何渠道：成功与否、酒店是哪家，都由渠道适配器从这份原始数据里解读。
 */
export type AmountSaveObserved = Readonly<{
  /** 命中的是哪个保存端点。取值由渠道适配器的 `saveEndpoints` 定义。 */
  endpointId: string;
  /** 这次保存请求的完整 URL（含 query）—— 上报给 RMS 当复盘依据。 */
  endpointUrl: string;
  /** 渠道原始请求体，一字不改——透传给 RMS 当证据。 */
  requestBody: JsonObject;
  /** 渠道原始响应体（未解析的字符串）。适配器据此判定这次保存是否成功。 */
  responseBody: string;
  /**
   * 发起这次保存的页面 URL —— 取自请求的 `Referer` 头，不是浏览器地址栏。
   *
   * 两者会不一样：渠道页面多是 SPA，页面内选了哪家门店常常只存在组件状态里，不回写地址栏。
   * 抖音实测就是如此（地址栏没有 `poi_id`，referer 里有）。referer 由浏览器在发请求那一刻
   * 填好，因此天然是「当刻快照」，不存在「用户点完保存立刻切门店」导致归错店的时序窗口。
   */
  pageUrl: string;
}>;

/**
 * 上报给 RMS 的形状——**渠道无关**。
 *
 * 公共字段只留三样：`source` 决定 RMS 怎么解读后两样，`otaHotelId` 是**尽力而为**的门店提示，
 * `requestBody` 是原始证据。渠道专有的定位字段（抖音的 `merchantGroupId` / `lifeAccountId` /
 * `productIds`）一律进 `channelExtra`——与 `channels/bind-extra.ts` 里 `bindExtra` 的既有套路
 * 一致，加渠道不必改这个契约。
 *
 * desktop **不查本地绑定、不算 hotelId、不展开日期×房型**：反查绑定与语义展开都由 RMS
 * 负责（RMS 侧已有这套逻辑）。代价是未绑定账号的改价也会照发，RMS 反查不到时自行丢弃
 * ——所以对 RMS 而言「反查失败」是正常情况，不该按错误告警。
 */
export type OtaAmountChangeReport = Readonly<{
  /** 幂等键，desktop 生成。RMS 据此去重（同一次改价重试上报不该跟两次价）。 */
  operationId: string;

  /** 操作人 —— 谁在这台 desktop 上登录并改了价（`StaffIdentity.userId`）。 */
  loginUserId: number | null;
  /** 操作人名字：优先 `fullName`，回退 `username`。 */
  loginUserName: string | null;

  source: ChannelId;
  /** 实际访问的完整 URL —— 出问题时凭这个复现「改的是哪个页面的哪个接口」。 */
  endpointUrl: string;
  /** 渠道内区分这次改的是价格还是房态房量。 */
  endpointId: string;

  /**
   * 渠道侧的门店 ID。**尽力而为，可能是空串** —— 渠道不一定暴露它（抖音走菜单进入时
   * URL 上没有 `poi_id`；携程新模块 `setRCRoomPrice` 的请求体里根本没有门店 ID）。
   * 为空时 RMS 靠 `channelExtra` 里的房型 ID 反查门店。
   */
  otaHotelId: string;

  /** 渠道账号 ID —— 用哪个 OTA 账号改的（`OtaCredential.channelAccountId`）。 */
  channelAccountId: string | null;
  /** 渠道账号名 —— 取自凭证的 `credentialExtra`（携程是 hotelName）。缺则 null。 */
  channelAccountName: string | null;

  /** 渠道原始请求体（剔除框架噪音字段，**不做语义转换**）。 */
  requestBody: JsonObject;
  /** 渠道原始响应体。RMS 复盘时据此确认渠道到底认没认这次改价。 */
  responseBody: string;

  /** 用户点保存的时刻，ISO 时间戳。 */
  submitAt: string;
}>;

/**
 * 渠道适配器解读原始事实后交出的东西 —— **只包含适配器看得见的部分**。
 *
 * 身份字段（操作人、渠道账号）不在这里：适配器活在 `channels/`，eslint 禁止它依赖
 * `services/` 与 `database/`，够不着 `StaffIdentity` 和 `OtaCredential`。这些由
 * `AmountChangeReportService` 在上报环节补齐 —— 与幂等键、时间戳同一个道理。
 */
export type OtaAmountChangeObserved = Omit<
  OtaAmountChangeReport,
  | 'operationId'
  | 'submitAt'
  | 'loginUserId'
  | 'loginUserName'
  | 'channelAccountId'
  | 'channelAccountName'
>;
