/**
 * 携程**房态房量菜单**改动的 `changeRaw` 模型 —— **RMS 侧对接这个端点时读这一份**。
 *
 * | | |
 * |---|---|
 * | `source` | `ctrip` |
 * | `endpointId` | `batchUpdateRoomStatusAndQuantity` |
 * | `changeType` | `roomStatus` |
 * | 页面 | `/rateplan/batchSetRoomStatusAndQuantity`（**只有批量入口**，无单点入口） |
 * | 端点 | `/restapi/soa2/23783/batchUpdateRoomStatusAndQuantity` |
 * | 数据来源 | 踩点 `docs/踩点/携程/房态房量菜单.md`（开房/关房两份带标注样本） |
 *
 * ============================================================================
 * ⚠️ 一句话摘要：携程有**两个**房态端点，本文件描述的这个与另一个**零字段同名**
 * ============================================================================
 *
 * 携程的房态可以从两个菜单改，走**两个完全不同的端点**。RMS **必须按 `endpointId` 分辨**，
 * 不能靠字段名猜 —— 二者没有一个字段是同名的：
 *
 * | 维度 | 日历菜单（老） | 房态房量菜单（本文件） |
 * |---|---|---|
 * | `endpointId` | `setbatchroombookablestatus` | `batchUpdateRoomStatusAndQuantity` |
 * | 页面 | `/ebkovsroom/inventory/calendar` | `/rateplan/batchSetRoomStatusAndQuantity` |
 * | 规格文件 | `./room-status-payload.ts` | **本文件** |
 * | 房型 | `hotelRoomInfoDtoList[].roomTypeID` 数字 | `roomProductIds[]` 顶层**字符串**数组 |
 * | 门店 | ✅ `hotelRoomInfoDtoList[].hotelID` | ❌ **请求体里根本没有** |
 * | 日期 | `dateItemInfoDtoList[]` | `dates.dateRanges[]` |
 * | 周次 | `weekDayIndex: "1111111"` 位串 | `dates.weekDays[]` 英文枚举 |
 * | 全选 | 无 | `dates.applyAllDates` 布尔 |
 * | 开关房 | `roomStatus: "G"` / `"N"` **字符串** | `roomStatus: 1` / `2` **数字** |
 * | 房量 | 无 | ✅ 三个字段（**本次不解析**，见下） |
 * | 噪音字段 | `dateItemInfoDtoList[].holidyInfo` | `reqHead` / `cipher` / `head` |
 * | 响应信封 | `{code, returnCode, data:null}` | `{taskId, resStatus, ResponseStatus}` |
 *
 * ⚠️ **开关房的取值形式两个端点不同，desktop 不做归一化**（归一化属于语义转换，违背忠实
 * 透传的定位）。RMS 要判开关房，必须先看 `endpointId` 再决定读 `"G"/"N"` 还是 `1/2`。
 *
 * ============================================================================
 * changeRaw 的完整样本（真实报文，开房）
 * ============================================================================
 *
 * ```json
 * {
 *   "roomProductIds": ["1602330530", "1569052068"],
 *   "dates": {
 *     "dateRanges": [{ "startDate": "2026-08-27", "endDate": "2026-08-28" }],
 *     "weekDays": ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"],
 *     "applyAllDates": false
 *   },
 *   "roomStatus": 1,
 *   "roomQuantityLimitType": -100,
 *   "remainRoomQuantityType": -100,
 *   "syncRoomQuantityWithSharedInventory": true
 * }
 * ```
 *
 * 关房样本与上面**逐字节相同，只有 `roomStatus` 变成 `2`** —— 踩点的开关两份 curl 全量
 * diff 只差这一个字段（`roomProductIds`、`dates`、`cipher` 完全一致）。
 *
 * ============================================================================
 * 逐字段含义
 * ============================================================================
 *
 * | 字段 | 类型 | 示例 | 含义 | RMS 怎么用 |
 * |---|---|---|---|---|
 * | `roomProductIds` | string[] | `["1602330530","1569052068"]` | 本次操作的**销售房型 ID**，字符串。**唯一的定位依据** | ⭐ 必读。既定位房型，也用于**反查门店** |
 * | `dates.dateRanges` | `{startDate,endDate}[]` | `[{"2026-08-27","2026-08-28"}]` | 生效日期区间，闭区间，`YYYY-MM-DD` | ⭐ 必读，与 `weekDays` 取交集展开 |
 * | `dates.weekDays` | string[] | `["SUNDAY","MONDAY",…]` | 区间内哪几个星期几生效，英文全大写枚举 | ⭐ 必读，与 `dateRanges` 取交集 |
 * | `dates.applyAllDates` | boolean | `false` | 用户是否勾了「应用到所有日期」。语义未证实：为 `true` 时是否忽略上面两项，**没有样本** | ⚠️ 谨慎，见「已知的坑」 |
 * | `roomStatus` | number | `1` / `2` | **`1` = 开房，`2` = 关房**。开关房的唯一依据 | ⭐ 必读。⚠️ 与老端点的 `"G"/"N"` 不同 |
 * | `roomQuantityLimitType` | number | `-100` | 房量限制类型 | ⛔ **本次不解析** |
 * | `remainRoomQuantityType` | number | `-100` | 剩余房量类型 | ⛔ **本次不解析** |
 * | `syncRoomQuantityWithSharedInventory` | boolean | `true` | 是否与共享库存同步房量 | ⛔ **本次不解析** |
 *
 * ## ⚠️ `roomStatus`：`1` 开房、`2` 关房
 *
 * 2026-08-21 踩点确认：开房与关房走**同一端点、同一形状**，整个请求体只差这一个字段。所以
 * desktop **不拆成两个 `endpointId`** —— 拆了等于让 desktop 解读渠道语义。与老房态端点同一
 * 处置，也与美团相反（美团开关房是**两个独立端点**）。
 *
 * **RMS 必须读这个字段**才知道用户是开房还是关房。只看 `changeType: 'roomStatus'` 分不出
 * 方向，把关房当开房处理会造成**超售**。
 *
 * ⚠️ **只有 `1` 和 `2` 是已证实的**，出现第三种取值时不要猜。
 *
 * ## ⛔ 房量三字段：透传但本次不解析
 *
 * `roomQuantityLimitType` / `remainRoomQuantityType` / `syncRoomQuantityWithSharedInventory`
 * **本次不踩点**，desktop 照常全量透传（透传是既定语义，不为此写任何特殊代码），
 * **RMS 不解析、不消费**。
 *
 * 已知信息仅为旁证，**未经专门验证**：开房与关房两份样本改的都是**房态**，这三个字段纹丝
 * 不动，始终是 `-100 / -100 / true`。据此**推测** `-100` 是「本次不改房量」的哨兵值。
 *
 * ⚠️⚠️ **RMS 务必不要把 `-100` 当成房量值写进业务台账** —— 它极可能是哨兵而非真实房量。
 * 要消费房量数据，必须先补做「只改房量」与「房态房量同改」两份踩点，确认真实取值形式。
 *
 * ## 门店怎么定位
 *
 * ```
 * otaHotelId  ❌ 空串 —— 请求体里没有任何门店标识
 * ```
 *
 * 用 `roomProductIds[]` 反查门店。`otaHotelId` 为空是**正常情况，不是错误** —— desktop 只当
 * 探针，不查本地绑定、不操作页面去凑这个值。反查由 RMS 做，它的追价台账本来就把房型 ID 与
 * 门店 ID 成对存着。与改价新模块 `setRCRoomPrice` 同一处境。
 *
 * ⚠️ 一次操作可能跨多家门店（样本里 `1602330530` 与 `1569052068` 就分属两家），而
 * `otaHotelId` 是单值且此处恒为空 —— **RMS 必须遍历 `roomProductIds[]` 全量反查**。
 *
 * ## 日期与周次要组合展开
 *
 * `dates.dateRanges[]` 给日期区间，`dates.weekDays[]` 给周次筛选，二者是**交集**关系：
 * 区间内、且星期几命中的那些天才生效。desktop 不展开（与改价、老房态一致，展开由 RMS 做）。
 *
 * 注意周次表达与老端点不同：老端点是 `"1111111"` 位串（周一→周日），这里是英文全大写枚举，
 * **不能复用同一套解析**。
 *
 * ============================================================================
 * 裁剪：剔三个 SOA 框架噪音字段
 * ============================================================================
 *
 * 与改价新模块 `setRCRoomPrice` **完全同一口径**（同为 `/restapi/soa2/` 下的 SOA 接口，
 * 框架字段相同），而与老房态端点不同（那边剔的是 `holidyInfo`）：
 *
 * | 字段 | 是什么 | 为什么必须剔 |
 * |---|---|---|
 * | `reqHead` | 浏览器/设备/UBT 埋点信息 | 含屏幕分辨率、IP、UA 等**设备指纹**，没必要出本机 |
 * | `cipher` | 每个房型的 `tripsign` 签名串 | **凭证性质**，泄漏有风险，且对 RMS 无用 |
 * | `head` | SOA 框架头（cid/ctok/sid/auth） | 含 `auth` 字段 |
 *
 * **只做剔除，不做任何语义转换** —— 保留原始字段名与结构，RMS 复盘时看到的就是渠道原文。
 * 三个都在顶层，浅层剔除即可（不像老房态端点的 `holidyInfo` 嵌在数组元素里）。
 *
 * ============================================================================
 * 已知的坑
 * ============================================================================
 *
 * - **是异步任务**：响应里有 `taskId`，说明携程只是**受理**了操作，真正写库在后台跑。
 *   `resStatus.rcode === 200` 代表受理成功，**不代表房态已生效**。与改价新模块同一处境，
 *   而与老房态端点不同（那个没有 `taskId`）。若 RMS 对时效敏感，需要考虑这层延迟。
 * - **`applyAllDates` 语义未证实**：两份样本都是 `false`。为 `true` 时是否意味着忽略
 *   `dateRanges`/`weekDays` 而应用到全部日期，**没有样本**。RMS 遇到 `true` 时不要臆断，
 *   应补踩点确认。
 * - **只有成功样本，没有失败样本**：携程拒绝时的响应形状未知，`isSuccessful` 存在「过松」
 *   的风险。真机若能构造一次失败应抓样本回填踩点文档并收紧判定。
 * - **响应体不上报**：成败已由适配器的 `isSuccessful` 判过（走 `isNewModuleSuccessful`，
 *   看 `resStatus.rcode` + `ResponseStatus.Ack`），判失败的根本走不到上报这一步。
 * - **房量字段见上**：透传但不解析，`-100` 不得当作房量值。
 */
import type { JsonObject } from '../../../shared/types/json';

/**
 * 携程房态房量菜单的 `changeRaw`。
 *
 * 用 `JsonObject` 的宽松形状而非逐字段严格类型，与同目录另外两份规格同一理由：desktop
 * **忠实透传、不解读语义**，逐字段建模等于在这里复刻携程的房态语义，而携程随时可能加字段
 * （加了就会被静默丢弃）。类型的作用是**说明结构**，校验只做到「能不能定位」为止。
 */
export type CtripRoomStatusQuantityRaw = JsonObject &
  Readonly<{
    /** 本次操作的销售房型 ID（字符串）。**唯一定位依据**，门店靠它反查。 */
    roomProductIds?: readonly unknown[];
    /** `{ dateRanges: [{startDate,endDate}], weekDays: ["MONDAY",…], applyAllDates }`。 */
    dates?: JsonObject;
    /** **`1` 开房 / `2` 关房** —— 开关的唯一依据。⚠️ 老端点是 `"G"`/`"N"` 字符串。 */
    roomStatus?: number;
    /** ⛔ 房量：透传但本次 RMS 不解析。⚠️ `-100` 疑为哨兵，不得当作房量值。 */
    roomQuantityLimitType?: number;
    /** ⛔ 同上。 */
    remainRoomQuantityType?: number;
    /** ⛔ 同上。 */
    syncRoomQuantityWithSharedInventory?: boolean;
  }>;

/**
 * 见文件头「裁剪」。三个都在顶层，浅层剔除即可。
 *
 * 与改价新模块 `toCtripAmountChangeRaw` 的噪音清单相同（同为 SOA 接口），但**故意不共用
 * 常量**：两个端点的裁剪口径是各自独立的决策，共用会让「携程哪天给其中一个端点加了新的
 * 框架字段」变成必须同时影响另一个，或者反过来因为耦合而不敢改。
 */
const NOISE_KEYS: readonly string[] = ['reqHead', 'cipher', 'head'];

/**
 * 从房态房量保存请求体构造 `changeRaw`：剔掉 SOA 框架噪音，其余原样。
 *
 * 顶层其余键一律原样带走 —— 透传原则，看不懂不等于该丢（房量三字段就走这条路径进 `changeRaw`）。
 */
export function toCtripRoomStatusQuantityRaw(requestBody: JsonObject): CtripRoomStatusQuantityRaw {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(requestBody)) {
    if (NOISE_KEYS.includes(key)) continue;
    kept[key] = value;
  }
  return kept as CtripRoomStatusQuantityRaw;
}
