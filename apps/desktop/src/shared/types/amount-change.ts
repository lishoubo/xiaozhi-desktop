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
  /** 命中的是哪个端点。取值由渠道适配器的 `watchedEndpoints` 定义。 */
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
 * 渠道差异全部收在 **`changeRaw` 一个字段**里：`source` + `endpointId` 决定 RMS 怎么解读它，
 * 其余字段（操作人、门店、账号、时间）三渠道同构。加渠道不必改这个契约 —— 新渠道往
 * `changeRaw` 里放自己的形状，并在 `channels/<渠道>/amount-change-payload.ts` 里写清规格。
 *
 * `otaHotelId` 是**尽力而为**的门店提示，可能是空串（渠道不一定暴露它），见字段注释。
 *
 * desktop **不查本地绑定、不算 hotelId、不展开日期×房型**：反查绑定与语义展开都由 RMS
 * 负责（RMS 侧已有这套逻辑）。代价是未绑定账号的改价也会照发，RMS 反查不到时自行丢弃
 * ——所以对 RMS 而言「反查失败」是正常情况，不该按错误告警。
 *
 * ## 落到线上的样子
 *
 * `POST /api/v1/app/ota-changes`（rms-server `AppOtaChangeController`），实现见
 * `main/gateway/rms/rms-amount-change-gateway-http.ts`。两点与本类型不完全一致：
 *
 * - **`loginUserId` / `loginUserName` 不发**：远端以 JWT 为准（报文字段可伪造）。契约里
 *   留着它们是为了本地日志与排查。
 * - **响应的 `status` 不是成败**：`PARSE_FAILED` / `HOTEL_UNRESOLVED` / `SKIPPED` 都是
 *   正常响应——上报是单向通知，失败在远端沉淀成台账，desktop 没有补救动作。
 *
 * ## 日期与周次：三个渠道四种表达（展开由 RMS 做）
 *
 * ```
 * douyin    date_period_list: [{start:"2026-05-28", end:"2026-05-31"}]
 *           available_week_list: [1,2,3,4,5,6,7]              // 1=周一
 *
 * ctrip 老  dateRangeInfo: [{startDate, endDate}]
 *           weekDayIndex: "1111001"                            // 位串，周一→周日
 *
 * ctrip 新  roomPriceInfos[].startDate / .endDate              // 每条自带日期
 *           weekDays: ["MONDAY","TUESDAY",…]                   // 英文枚举
 *
 * meituan   unifiedDatePriceInfos.dates[] （形状①）           // 或 priceInfos[]（形状②）
 *           weekPriceInfos[].inWeek: [1,2,3,4,7]               // 数字，1=周一（同抖音）
 * ```
 *
 * ⚠️ **不能假设房型在一次上报里唯一** —— 开了「周末差异定价」时同一房型会按周次拆成多条，
 * 各带不同价格，必须按 (房型 × 周次) 组合展开。携程与美团都有这种形状。
 *
 * ## 门店怎么定位
 *
 * ```
 *                             otaHotelId 有值吗    RMS 该怎么反查
 * douyin                          基本没有         用 product_list[].product_id
 *                                                  （= ota_sale_room_type_id）反查门店
 * ctrip / batchsetroomprice       ✅ 有            直接用；⚠️ 一次可能改多家
 * ctrip / setRCRoomPrice          ❌ 请求体里没有   用 roomPriceInfos[].roomProductId 反查
 * meituan                         ✅ 有（最可靠）   试算请求体顶层 `poiId`，单值，一次一家
 * ```
 *
 * ## 其他已知的坑
 *
 * 1. **只有渠道判定成功的改价才会上报** —— 渠道拒绝（限价、佣金校验不过）的不发。
 * 2. **携程新模块与美团都是异步任务**：响应里的 `taskId` 只代表渠道**受理**成功，
 *    不代表价格已生效。
 * 3. **上报失败不重试落盘**：网络失败重试 1 次后放弃，偶发漏报是已知取舍。
 */
/**
 * 这次改动属于哪一类 —— **意向标记，不是精确分类**。
 *
 * ```
 * price       价格类改动
 * roomStatus  量态类改动的统称 —— 房态开关 + 房量，两者不再细分
 * ```
 *
 * ## ⚠️ 为什么 `roomStatus` 不拆成「房态」「房量」两个值
 *
 * **一个渠道端点可能在一次请求里同时改房态和房量**，拆了就必然有说不准的情况：抖音的
 * `batch_save_stock_state_calendar` 就是这样（同一个 `calendar_ari_list` 里房态一条、
 * 库存一条），一个端点只能给一个值，报哪个都是错的。
 *
 * ## ⚠️ RMS 必须读 `changeRaw`，不能只认 `changeType`
 *
 * 这个字段只回答「这次是价还是量态」，**不回答「量态里究竟改了什么」**。RMS 按它分流之后，
 * 仍必须从 `changeRaw` 里读实际改动的内容。只认 `changeType` 就分支处理的失效方式很隐蔽：
 * 接抖音那个端点时会把请求体里的房量部分整段漏掉，**且没有任何报错**。
 *
 * ## 与 `endpointId` 是两个粒度，互不替代
 *
 * ```
 * changeType   改的是什么      price / roomStatus        RMS 分流用
 * endpointId   走的哪个接口    setRCRoomPrice 等          RMS 解析 changeRaw 形状用
 * ```
 *
 * 携程改价有新老两套模块、`changeRaw` 形状完全不同，光有 `changeType: 'price'` 解析不了
 * —— 所以 `endpointId` 删不掉。反过来，靠 `(source, endpointId)` 查表反推语义则要求 RMS
 * 侧维护一张映射表，desktop 每加一个端点都得通知对方同步一行 —— 所以 `changeType` 也省不掉。
 */
export type OtaChangeType = 'price' | 'roomStatus';

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
  /**
   * 这次改的是价还是量态。**意向标记，RMS 仍须读 `changeRaw` 确认实际改了什么** ——
   * 完整说明见 `OtaChangeType`。
   */
  changeType: OtaChangeType;
  /**
   * 渠道内走的是哪个接口。与 `changeType` 是两个粒度：这个决定 `changeRaw` 的**形状**
   * （携程改价新老两套模块形状完全不同），`changeType` 决定 RMS 怎么**分流**。
   */
  endpointId: string;

  /**
   * 渠道侧的门店 ID。**尽力而为，可能是空串** —— 渠道不一定暴露它（抖音走菜单进入时
   * URL 上没有 `poi_id`；携程新模块 `setRCRoomPrice` 的请求体里根本没有门店 ID）。
   * 为空时 RMS 靠 `channelExtra` 里的房型 ID 反查门店。
   *
   * ⚠️ **携程这一项被归一过**：同一家酒店的预付与现付是两个不同的 hotelID，报文里出现
   * 的是本次操作那一侧，与 RMS 登记的对不上。上报前会用凭证里的 `masterHotelId` 覆盖
   * （见 `services/amount-change-report-service.ts`），与绑定探测口径一致。拿不到时
   * 保留报文原值。`changeRaw` 始终是原始报文，不受此影响。
   */
  otaHotelId: string;

  /** 渠道账号 ID —— 用哪个 OTA 账号改的（`OtaCredential.channelAccountId`）。 */
  channelAccountId: string | null;
  /** 渠道账号名 —— 取自凭证的 `credentialExtra`（携程是 hotelName）。缺则 null。 */
  channelAccountName: string | null;

  /**
   * **这次改动的内容** —— 渠道原始数据，形状由 `source` + `endpointId` 决定。
   *
   * 各渠道往里放什么、每个字段怎么解读，定义在各自的 payload 模型里（**RMS 侧对接时读这几份**）：
   *
   * ```
   * douyin    channels/douyin/amount-change-adapter.ts    保存请求体，原样
   * ctrip     channels/ctrip/amount-change-payload.ts     保存请求体，剔 3 个框架噪音字段
   * meituan   channels/meituan/amount-change-payload.ts   裁剪后的**试算结果**（含改前价+改后价）
   * ```
   *
   * ⚠️ **不发响应体**：渠道认没认这次改价已由适配器的 `isSuccessful` 判过，判失败的根本
   * 不会走到上报这一步，响应对 RMS 没有额外信息。
   *
   * ⚠️ **美团放的是试算而非保存请求**：它的保存请求体只说「卖价 +2 元」不说原价，而 RMS
   * 侧没有美团的数据，既算不出绝对价也无从校验。详见美团那份 payload 模型。
   */
  changeRaw: JsonObject;

  /** 用户点保存的时刻，ISO 时间戳。 */
  submitAt: string;
}>;

/**
 * 渠道适配器解读原始事实后交出的东西 —— **只包含适配器看得见的部分**。
 *
 * 身份字段（操作人、渠道账号）不在这里：适配器活在 `channels/`，eslint 禁止它依赖
 * `services/` 与 `database/`，够不着 `StaffIdentity` 和 `OtaCredential`。这些由
 * `AmountChangeReportService` 在上报环节补齐 —— 与幂等键、时间戳同一个道理。
 *
 * ⚠️ `changeType` **故意不在 Omit 列表里**：这次改的是价还是量态，只有最懂渠道的适配器
 * 才判得准（同一渠道的不同端点语义不同），service 层无从推断，所以由适配器负责提供。
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
