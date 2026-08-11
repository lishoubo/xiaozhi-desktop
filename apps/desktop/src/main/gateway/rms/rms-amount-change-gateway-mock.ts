/**
 * `RmsAmountChangeGateway` 的 mock 实现 —— 只把上报体记进日志，不发 HTTP。
 *
 * 本期用 mock 是有意的：RMS 侧的接收端点还没定（谁反查绑定、怎么展开日期×房型、跟价策略
 * 放哪，都在 RMS 那边设计）。desktop 这一侧的拦截、配对、解析链路可以先独立跑通并真机验证，
 * 不必等远端。
 *
 * 换真实实现时照 `HttpRmsHotelGateway` 的形状写即可 —— `createRmsApiCall` + 已带认证的
 * fetch，本文件删掉，composition root 换一行装配。**接口不用改**。
 *
 * ============================================================================
 * 给 RMS 侧：怎么解析这份上报
 * ============================================================================
 *
 * ## 公共字段（所有渠道、所有端点都有）
 *
 * | 字段 | 类型 | 说明 |
 * |---|---|---|
 * | `operationId` | string | **幂等键**，desktop 生成的 UUID。重试上报用同一个，据此去重 |
 * | `loginUserId` | number \| null | 操作人（RMS 员工 ID）。未登录 / 查询失败时为 null |
 * | `loginUserName` | string \| null | 操作人名字（`fullName` 优先，回退 `username`） |
 * | `source` | 'douyin' \| 'ctrip' \| 'meituan' | 哪个渠道 |
 * | `endpointUrl` | string | 实际请求的完整 URL（含 query），复盘用 |
 * | `endpointId` | string | **解析 `requestBody` 的分派键**，见下表 |
 * | `otaHotelId` | string | 渠道门店 ID。**尽力而为，常为空串** —— 见「门店怎么定位」 |
 * | `channelAccountId` | string \| null | 用哪个 OTA 账号改的 |
 * | `channelAccountName` | string \| null | 该账号的名字（携程存的是酒店名） |
 * | `requestBody` | object | 渠道**原始**请求体，剔除框架噪音后**未做任何语义转换** |
 * | `responseBody` | string | 渠道原始响应体（字符串原文） |
 * | `submitAt` | string | 用户点保存的时刻，ISO8601 |
 *
 * **只有渠道判定成功的改价才会上报** —— 渠道拒绝（限价、佣金校验不过）的不发。
 *
 * ## endpointId → requestBody 形状的分派表
 *
 * ```
 * source   endpointId                        requestBody 形状
 * ───────  ────────────────────────────────  ──────────────────────────────────────
 * douyin   save_amount_calendar              { product_list: [{product_id, normal_price}],
 *                                              date_period_list: [{start, end}],
 *                                              available_week_list: [1..7] }
 *
 * ctrip    batchsetroomprice   （老模块）      { roomPriceInfoList: [{roomTypeID, hotelID,
 *                                                salePrice, costPrice, weekDayIndex,
 *                                                refRoomIDs}],
 *                                              dateRangeInfo: [{startDate, endDate}] }
 *
 * ctrip    setRCRoomPrice      （新模块）      { roomPriceInfos: [{roomProductId, startDate,
 *                                                endDate, salePrice, costPrice,
 *                                                commissionRate, weekDays,
 *                                                excludedRelationRoomProductIds}],
 *                                              dateRanges: [{startDate, endDate}] }
 * ```
 *
 * ⚠️ **携程两套模块并存**，同一个账号走不同入口会产生不同形状 —— 必须按 `endpointId` 分支，
 * 不能只认一种。二者字段名无一相同（`roomTypeID` vs `roomProductId`、
 * `dateRangeInfo` vs `dateRanges`、`weekDayIndex` 位串 vs `weekDays` 字符串数组）。
 *
 * ## 门店怎么定位（重要）
 *
 * ```
 *                        otaHotelId 有值吗    RMS 该怎么反查
 * douyin                      基本没有         用 product_list[].product_id
 *                                              （= ota_sale_room_type_id）反查门店
 * ctrip / batchsetroomprice   ✅ 有            直接用；多店时见下
 * ctrip / setRCRoomPrice      ❌ 请求体里没有   用 roomPriceInfos[].roomProductId 反查门店
 * ```
 *
 * **`otaHotelId` 为空是正常情况，不是错误** —— desktop 只当探针，不查本地绑定、不操作页面
 * 去凑这个值（那会违背「绝不碰用户页面」的前提）。反查由 RMS 做，它的追价台账本来就把
 * 房型 ID 与门店 ID 成对存着。
 *
 * ⚠️ **老模块一次可以改多家门店**：`roomPriceInfoList[]` 里的 `hotelID` 可能不止一个，而
 * `otaHotelId` 是单值（取第一家）。**RMS 必须遍历 `requestBody.roomPriceInfoList[].hotelID`
 * 全量处理，只认 `otaHotelId` 会漏掉同一次保存里的其他门店。**
 *
 * ## 日期与周次的两套表达
 *
 * ```
 * douyin    date_period_list: [{start:"2026-05-28", end:"2026-05-31"}]
 *           available_week_list: [1,2,3,4,5,6,7]              // 1=周一
 *
 * ctrip 老  dateRangeInfo: [{startDate:"2026-08-19", endDate:"2026-08-19"}]
 *           weekDayIndex: "1111001"                            // 位串，周一→周日
 *
 * ctrip 新  roomPriceInfos[].startDate / .endDate              // 每条自带日期
 *           weekDays: ["MONDAY","TUESDAY",…]                   // 英文枚举
 * ```
 *
 * 日期×房型的展开由 RMS 做（decision 12：desktop 忠实透传，不做语义转换）。
 *
 * ## 已知的坑
 *
 * 0. ⚠️ **同一个房型会在 `roomPriceInfos[]` 里出现多次**（2026-08-11 真机验证发现）。
 *    用户开「周末差异定价」时，携程把一个房型按周次拆成多条，各带不同价格：
 *
 *    ```
 *    roomProductId 1587157522  weekDays:[MON,TUE,WED,THU,FRI,SUN]  salePrice 720
 *    roomProductId 1587157522  weekDays:[SATURDAY]                 salePrice 721  ← 同一房型
 *    ```
 *
 *    外层同时有 `diffWeekendPrice: true` 与 `weekendDays: ["SATURDAY"]`。
 *    **RMS 展开时不能假设房型唯一，必须按 (房型 × 周次) 组合展开**，按房型去重会丢价格档。
 *
 * 1. **携程新模块是异步任务**：响应里的 `taskId` 说明携程只是**受理**了改价，真正写库在后台
 *    跑。`resStatus.rcode === 200` 代表受理成功，**不代表价格已生效**。若 RMS 对时效敏感，
 *    需要考虑这层延迟。
 * 2. **`requestBody` 剔除了三个框架字段**：`reqHead`（设备指纹/IP/UA）、`cipher`（房型签名串，
 *    凭证性质）、`head`（含 auth）。其余字段名与结构原样保留。
 * 3. **上报失败不重试落盘**：网络失败重试 1 次后放弃（decision 14）。偶发漏报是已知取舍。
 * 4. **未绑定 RMS 的账号改价也会上报** —— 反查不到时请当正常情况丢弃，不要按错误告警。
 *
 * ## 一份完整样例（携程新模块，**取自 2026-08-11 真机实测**，仅脱敏 operationId）
 *
 * 这条同时演示了「周末差异定价」——注意 `1587157522` 出现了两次。
 *
 * ```json
 * {
 *   "operationId": "d309b1e7-48c7-4978-8c52-9e274862acd9",
 *   "loginUserId": 1,
 *   "loginUserName": "Dev Admin",
 *   "source": "ctrip",
 *   "endpointUrl": "https://ebooking.ctrip.com/restapi/soa2/23783/setRCRoomPrice?_fxpcqlniredt=09031162210038262124&x-traceID=…",
 *   "endpointId": "setRCRoomPrice",
 *   "otaHotelId": "",
 *   "channelAccountId": "85068938",
 *   "channelAccountName": "银际酒店(包头市青山王府井文化路店)",
 *   "requestBody": {
 *     "roomPriceInfos": [
 *       { "roomProductId": "1587157522", "startDate": "2026-08-25", "endDate": "2026-08-26",
 *         "priceChangeMode": "sale_commissionRate", "salePrice": 720, "costPrice": 611.71,
 *         "commissionRate": 0.1504, "currency": "RMB", "mealNum": 0,
 *         "excludedRelationRoomProductIds": [],
 *         "weekDays": ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SUNDAY"] },
 *       { "roomProductId": "1587157522", "startDate": "2026-08-25", "endDate": "2026-08-26",
 *         "priceChangeMode": "sale_commissionRate", "salePrice": 721, "costPrice": 612.56,
 *         "commissionRate": 0.1504, "currency": "RMB", "mealNum": 0,
 *         "excludedRelationRoomProductIds": [],
 *         "weekDays": ["SATURDAY"] },
 *       { "roomProductId": "1587157528", "startDate": "2026-08-25", "endDate": "2026-08-26",
 *         "priceChangeMode": "sale_commissionRate", "salePrice": 793, "costPrice": 672.7,
 *         "commissionRate": 0.1517, "currency": "RMB", "mealNum": 2,
 *         "excludedRelationRoomProductIds": [],
 *         "weekDays": ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SUNDAY"] },
 *       { "roomProductId": "1587157528", "startDate": "2026-08-25", "endDate": "2026-08-26",
 *         "priceChangeMode": "sale_commissionRate", "salePrice": 795, "costPrice": 674.4,
 *         "commissionRate": 0.1517, "currency": "RMB", "mealNum": 2,
 *         "excludedRelationRoomProductIds": [],
 *         "weekDays": ["SATURDAY"] }
 *     ],
 *     "isFixedCommission": false,
 *     "dateRanges": [{ "startDate": "2026-08-25", "endDate": "2026-08-26" }],
 *     "weekDays": ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"],
 *     "priceChangeMode": "priceMode",
 *     "diffWeekendPrice": true,
 *     "weekendDays": ["SATURDAY"]
 *   },
 *   "responseBody": "{\"taskId\":\"71757520-cfb9-4c19-ad10-6c5e3b7c40ad_202608\",\"resStatus\":{\"rcode\":200,\"rmsg\":\"\"},\"ResponseStatus\":{\"Ack\":\"Success\",\"Errors\":[]}}",
 *   "submitAt": "2026-08-11T09:12:55.598Z"
 * }
 * ```
 *
 * 这条的语义：**操作人 Dev Admin(1) 用携程账号「银际酒店(包头市青山王府井文化路店)」，把
 * 2 个房型在 2026-08-25 ~ 2026-08-26 改价；开了周末差异定价，周六单独一档
 * (720/721、793/795)。** 门店 ID 要靠 `roomProductId` 反查。
 *
 * 另外两个渠道/端点的 `requestBody` 样例见各自适配器文件头与
 * `openspec/changes/ota-amount-change-watch/design.md` §12。
 */
import type { AppLogger } from '../../../shared/logging';
import type { OtaAmountChangeReport } from '../../../shared/types/amount-change';
import type { RmsAmountChangeGateway } from './types';

export class MockRmsAmountChangeGateway implements RmsAmountChangeGateway {
  constructor(private readonly logger: AppLogger) {}

  reportAmountChange(report: OtaAmountChangeReport): Promise<void> {
    // 完整打出来（含 requestBody）——真机验证阶段就靠这条日志确认拦到的东西对不对。
    this.logger.info('[MOCK] Reporting amount change to RMS', {
      operationId: report.operationId,
      loginUserId: report.loginUserId,
      loginUserName: report.loginUserName,
      source: report.source,
      endpointUrl: report.endpointUrl,
      endpointId: report.endpointId,
      otaHotelId: report.otaHotelId,
      channelAccountId: report.channelAccountId,
      channelAccountName: report.channelAccountName,
      requestBody: report.requestBody,
      responseBody: report.responseBody,
      submitAt: report.submitAt,
    });
    return Promise.resolve();
  }
}
