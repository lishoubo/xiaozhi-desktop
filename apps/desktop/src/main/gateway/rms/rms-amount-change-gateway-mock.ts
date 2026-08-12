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
 * 给 RMS 侧：上报体的公共字段
 * ============================================================================
 *
 * | 字段 | 类型 | 说明 |
 * |---|---|---|
 * | `operationId` | string | **幂等键**，desktop 生成的 UUID。重试上报用同一个，据此去重 |
 * | `loginUserId` | number \| null | 操作人（RMS 员工 ID）。未登录 / 查询失败时为 null |
 * | `loginUserName` | string \| null | 操作人名字（`fullName` 优先，回退 `username`） |
 * | `source` | 'douyin' \| 'ctrip' \| 'meituan' | 哪个渠道 |
 * | `endpointUrl` | string | 实际请求的完整 URL（含 query），复盘用 |
 * | `endpointId` | string | **解析 `changeRaw` 的分派键**，见下表 |
 * | `otaHotelId` | string | 渠道门店 ID。**尽力而为，可能是空串** —— 见下 |
 * | `channelAccountId` | string \| null | 用哪个 OTA 账号改的 |
 * | `channelAccountName` | string \| null | 该账号的名字（携程存的是酒店名） |
 * | `changeRaw` | object | **这次改动的内容**，形状由渠道决定，见下 |
 * | `submitAt` | string | 用户点保存的时刻，ISO8601 |
 *
 * **只有渠道判定成功的改价才会上报** —— 渠道拒绝（限价、佣金校验不过）的不发。因此
 * **不上报响应体**：成功与否已在 desktop 侧判过，响应对 RMS 没有额外信息。
 *
 * ## changeRaw 的形状：按 (source, endpointId) 分派
 *
 * ```
 * source   endpointId          changeRaw 是什么         详细规格（RMS 对接必读）
 * ───────  ──────────────────  ───────────────────────  ────────────────────────────────
 * douyin   save_amount_calendar 保存请求体，原样         channels/douyin/amount-change-adapter.ts
 * ctrip    batchsetroomprice    保存请求体，剔 3 个       channels/ctrip/amount-change-payload.ts
 * ctrip    setRCRoomPrice       框架噪音字段              （两套模块并存，形状完全不同）
 * meituan  calcPriceV2          ⚠️ **试算结果**，非请求体  channels/meituan/amount-change-payload.ts
 * ```
 *
 * ⚠️ **每个渠道的字段含义、坑与未实测项都写在上面那几份 payload 模型里**，本文件只讲公共
 * 部分。三个渠道的差异比想象中大（携程两套模块字段名无一相同、美团发的根本不是保存请求），
 * 照着这张表猜形状会出错。
 *
 * ⚠️ **美团的 `endpointId` 是 `calcPriceV2` 而不是保存端点**：它的保存请求体只说「卖价
 * +1 元」不说原价，RMS 既算不出绝对价也无从校验，所以上报的是**试算**那次的结果
 * （含改前价与改后价），`endpointId`/`endpointUrl` 如实指向试算。详见美团那份模型。
 *
 * ## 门店怎么定位
 *
 * ```
 *                             otaHotelId 有值吗    RMS 该怎么反查
 * douyin                          基本没有         用 product_list[].product_id
 *                                                  （= ota_sale_room_type_id）反查门店
 * ctrip / batchsetroomprice       ✅ 有            直接用；⚠️ 一次可能改多家，见携程那份模型
 * ctrip / setRCRoomPrice          ❌ 请求体里没有   用 roomPriceInfos[].roomProductId 反查
 * meituan                         ✅ 有（最可靠）   试算请求体顶层 `poiId`，单值，一次一家
 * ```
 *
 * **`otaHotelId` 为空是正常情况，不是错误** —— desktop 只当探针，不查本地绑定、不操作页面
 * 去凑这个值（那会违背「绝不碰用户页面」的前提）。反查由 RMS 做，它的追价台账本来就把
 * 房型 ID 与门店 ID 成对存着。
 *
 * ## 日期与周次：三个渠道四种表达
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
 * 日期×房型的展开由 RMS 做（design.md decision 12：desktop 忠实透传，不做语义转换）。
 * ⚠️ **不能假设房型在一次上报里唯一** —— 开了「周末差异定价」时同一房型会按周次拆成多条，
 * 各带不同价格，必须按 (房型 × 周次) 组合展开。携程与美团都有这种形状。
 *
 * ## 其他已知的坑
 *
 * 1. **携程新模块与美团都是异步任务**：响应里的 `taskId` / 任务串只代表渠道**受理**成功，
 *    **不代表价格已生效**。若 RMS 对时效敏感，需要考虑这层延迟。
 * 2. **上报失败不重试落盘**：网络失败重试 1 次后放弃（design.md decision 14）。
 *    偶发漏报是已知取舍。
 * 3. **未绑定 RMS 的账号改价也会上报** —— 反查不到时请当正常情况丢弃，不要按错误告警。
 */
import type { OtaAmountChangeReport } from '../../../shared/types/amount-change';
import type { AppLogger } from '../../../shared/logging';
import type { RmsAmountChangeGateway } from './types';

export class MockRmsAmountChangeGateway implements RmsAmountChangeGateway {
  constructor(private readonly logger: AppLogger) {}

  reportAmountChange(report: OtaAmountChangeReport): Promise<void> {
    // 完整打出来（含 changeRaw）—— 真机验证阶段就靠这条日志确认拦到的东西对不对。
    //
    // ⚠️ `changeRaw` **先 JSON.stringify 再交给日志**，不能直接传对象。日志底层是 Node 的
    // `util.inspect`，它遍历对象时超过 depth 就把剩下的写成 `[Object]`，**且是在写入那一刻
    // 就丢掉了**，事后无法从日志文件还原。渠道数据的嵌套深度不由我们控制：美团实测就有
    // 两种形状，价格恰好落在最深处（2026-08-11 真机两次踩到，第二次连调大后的 depth 都不够）。
    //
    // 字符串没有嵌套，`util.inspect` 原样输出，**任何深度都完整落盘** —— 这是结构性解决，
    // 不必再为每种新形状去猜 depth 该设多少。代价只是日志里这个字段是紧凑 JSON 而非缩进
    // 对象，排查时管道过一下 `jq` 即可。
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
      changeRaw: JSON.stringify(report.changeRaw),
      submitAt: report.submitAt,
    });
    return Promise.resolve();
  }
}
