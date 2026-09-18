/**
 * 从美团房量改动的 `changeRaw` 还原「本次改动影响了哪些房型、哪些日期」—— 回读的输入。
 *
 * **本文件是 `meituan/` 的内部实现**，不出现在 `channels/types.ts` 的任何跨渠道接口上：
 * 「要不要回读、读哪些房型日期」是渠道自己的事，机制层不认识端点名。
 *
 * ## 入参是 `changeRaw`
 *
 * 美团量态路径的 `parse` 是**原样透传请求体**（无裁剪），所以 `changeRaw` 就是完整请求体。
 * 复用它白捡三件事：`isSuccessful` 已判过、房型取不到时 `parse` 已返回 `null`、门店已解出。
 *
 * ## ⚠️ 精确还原，既不能漏也不能多
 *
 * 服务端拿回读结果去**追价**。多报的日期会被当成需要跟的目标跟到抖音去 —— 那不是冗余，
 * 是**擅自扩大用户的改动范围**。所以星期筛选必须参与展开，不能用「宁可多读」兜底。
 *
 * ## 报文结构
 *
 * ```json
 * {
 *   "poiId": "1834077877",
 *   "partnerId": 4824962,
 *   "modifyInventoryModelList": [{
 *     "modifyInventorySubjectsModel": {
 *       "dayRoomIdList": [493882496],   // ← 日租，要
 *       "hourRoomIdList": [],           // ← 钟点房，不要
 *       "goodsIdList": []
 *     },
 *     "unifiedOperateInvDateModel": {
 *       "modifyDates": [{"startDate":"2026-09-09","endDate":"2026-10-08"}],
 *       "modifyParamByEffectWeeks": [
 *         {"effectWeek":[1,2,3,4,7], "updateInventoryUnifyInvUnitParam":{...}},
 *         {"effectWeek":[5,6],       "updateInventoryUnifyInvUnitParam":{...}}
 *       ]
 *     }
 *   }]
 * }
 * ```
 *
 * ## ⚠️ 所有房型共用同一组日期
 *
 * 产品交互是**先选房型，再选日期**。`modifyInventoryModelList` 虽是数组，但各元素的
 * `unifiedOperateInvDateModel` **逐字相同**，只有 `dayRoomIdList` 不同 ——
 * `批量改房态房量.md` 的 3 房型样本实证：三个元素的日期段与周次档完全一致。
 *
 * 所以还原就是最朴素的汇总：房型并集 × 日期并集。**不按 model 分别配对**。
 *
 * ⚠️ 也不要为「万一各 model 日期不同」加保护性分支：那个情况在产品上不存在，
 * 多写一个分支就多一个判错的机会，且它永远走不到、测不出。
 */
import type { JsonObject } from '../../../shared/types/json';

/** 回读的目标。`dates` 已经是**交集展开后的具体日期**，不再含星期概念。 */
export type MeituanReadbackTargets = Readonly<{
  /** 日租物理房型 id。升序去重。 */
  roomIds: readonly number[];
  /** 升序、去重、`YYYY-MM-DD`。 */
  dates: readonly string[];
  /** 门店 id，取自报文顶层 —— 回读请求要用。 */
  poiId: string;
  /** 商户号，取自报文顶层。⚠️ 不是 `credentialExtra.partnerId`（账号级），见下。 */
  partnerId: number;
}>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 星期解析的三种结果。⚠️ **「没有星期概念」与「形状不符」必须分开** —— 见下。
 */
type WeekdayParse =
  /** 字段缺失 / 空数组 —— 本就没有星期概念，不过滤（等同全选）。 */
  | Readonly<{ kind: 'all' }>
  /** 解析出的 ISO 星期集合。 */
  | Readonly<{ kind: 'some'; days: ReadonlySet<number> }>
  /** 报文形状不符（非数组、越界、非整数）—— 不猜，整次放弃回读。 */
  | Readonly<{ kind: 'malformed' }>;

/**
 * ISO 星期数集合。`[5,6]` → `{5,6}` = 周五周六。
 *
 * ⚠️ **1 = 周一**（ISO 序）。这是**核实的**，不是猜的：
 *
 * 1. 服务端已在生产按 ISO 消费 —— `AppOtaChangeIngestService.toDayOfWeek()` 用
 *    `DayOfWeek.of(v)`，Java 的 `java.time.DayOfWeek` 定义即 1=MONDAY。
 * 2. 业务语义自洽 —— `批量改房态房量.md` 的关房样本把 `[5,6]` 单列配 `invSwitch:0`，
 *    按 ISO 即周五周六，正是酒店业的 weekend 口径。
 * 3. 真机实证（2026-09-18）：10-23 是周五，落进 `[5,6]` 那档拿到 19；若基准反了会拿到 17。
 *
 * ⚠️ 不可拿改价链路的「美团 ISO 星期」结论直接套 —— 那是另一个字段，依据是上面三条。
 *
 * ## ⚠️ 「不过滤」与「形状不符」是两件事，不可都退化成不过滤
 *
 * | 输入 | 结果 | 理由 |
 * |---|---|---|
 * | 字段缺失 / `[]` | `all`（不过滤） | 本就没有星期概念，与服务端 `List.of()` + `if (!isEmpty())` 一致 |
 * | `[5,6]` | `some` | 正常 |
 * | 非数组 / `[0]` / `[8]` / `["x"]` | **`malformed`** | 报文形状不符 —— **不猜** |
 *
 * 早先把「全部元素非法」也返回 `null`（= 不过滤），造成一个**不对称**：
 * `[5,99]` 只丢坏元素、过滤照做（1 天），而 `[0]` 反而整个区间全展开（7 天）。
 * 后者是**多读**，服务端拿 `cells` 去追价会把用户没碰过的日期跟到其他渠道 ——
 * 正是本文件头「既不能漏也不能多」明令要防的事，且失效**静默**（日志只有 `dateCount`）。
 *
 * ⚠️ 也**不能**改成「非法就当空集、过滤掉所有天」 —— 那会变成静默**漏报**。
 * 形状不符时唯一安全的做法是整次放弃回读（`extractMeituanReadbackTargets` 返回 `null`），
 * 与服务端 `RawBodyReader.weekdaysFromInts` 的 fail-closed 同向（它对这三种情况
 * 一律 `throw malformed`，javadoc 明写「越界视为报文形状不符，不静默丢弃」）。
 */
function weekdaysFromInts(values: unknown): WeekdayParse {
  if (values === undefined || values === null) return { kind: 'all' };
  if (!Array.isArray(values)) return { kind: 'malformed' };
  if (values.length === 0) return { kind: 'all' };

  const days = new Set<number>();
  for (const item of values) {
    // null 元素跳过，与服务端 `if (item == null) continue` 一致。
    if (item === null || item === undefined) continue;
    const n = toFiniteNumber(item);
    if (n === null || !Number.isInteger(n) || n < 1 || n > 7) return { kind: 'malformed' };
    days.add(n);
  }
  // 全是 null 元素 —— 等同空数组。
  return days.size === 0 ? { kind: 'all' } : { kind: 'some', days };
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 解析 `YYYY-MM-DD` 为**本地**零点。用本地时区是为了让「周几」与用户看到的一致。 */
function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** ISO 星期数：`Date.getDay()` 的周日是 0，这里要 7。 */
function isoWeekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return value.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  return null;
}

function asObject(value: unknown): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as JsonObject;
}

/**
 * 把 `[{startDate, endDate}]` 展开成日期列表，并按星期集合过滤。
 *
 * 区间是**闭区间**（两端都含）。起止颠倒或日期不合法的项跳过 —— 不猜用户意图。
 */
function expandRanges(ranges: readonly unknown[], weekdays: ReadonlySet<number> | null): string[] {
  const dates: string[] = [];
  for (const range of ranges) {
    const r = asObject(range);
    if (!r) continue;
    const start = parseIsoDate(r.startDate);
    const end = parseIsoDate(r.endDate);
    if (!start || !end || start.getTime() > end.getTime()) continue;

    for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
      const day = new Date(t);
      if (weekdays !== null && !weekdays.has(isoWeekday(day))) continue;
      dates.push(toIsoDate(day));
    }
  }
  return dates;
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * @param endpointId 既有适配器算好的端点标识
 * @param changeRaw  既有 `parse` 产出的上报体内容（美团量态是原样请求体）
 * @returns `null` = 本次改动不需要回读
 */
export function extractMeituanReadbackTargets(
  endpointId: string,
  changeRaw: JsonObject,
  inventoryEndpointId: string,
): MeituanReadbackTargets | null {
  // 只认房量端点。房态开关 / 关房 / 改价一律不回读。
  if (endpointId !== inventoryEndpointId) return null;

  // ⚠️ 门店与商户号从**触发报文**取，不从凭证取：`gateway/rms/types.ts` 记载美团门店级
  // partnerId 与 `credentialExtra.partnerId`（账号级）**不是同一个值**。报文里两者都在
  // 顶层且与本次改动同源，天然一致。
  const poiId = changeRaw.poiId;
  const partnerId = toFiniteNumber(changeRaw.partnerId);
  if ((typeof poiId !== 'string' && typeof poiId !== 'number') || partnerId === null) return null;
  const poiIdText = String(poiId).trim();
  if (poiIdText === '') return null;

  const models = changeRaw.modifyInventoryModelList;
  if (!Array.isArray(models)) return null;

  const roomIds: number[] = [];
  const dates: string[] = [];

  for (const rawModel of models) {
    const model = asObject(rawModel);
    if (!model) continue;

    // 只取日租。钟点房不跟 —— 与服务端 `MeituanInventoryUpdateTranslator` 同口径
    // （类注释：「hourRoomIdList（钟点房）不处理：本链路只跟日历房」）。
    const subjects = asObject(model.modifyInventorySubjectsModel);
    const dayRoomIds = subjects && Array.isArray(subjects.dayRoomIdList)
      ? subjects.dayRoomIdList.map(toFiniteNumber).filter((id): id is number => id !== null)
      : [];
    // 该 model 只有钟点房 → 跳过这一个，不是整次放弃（服务端同样是 continue）。
    if (dayRoomIds.length === 0) continue;

    const dateModel = asObject(model.unifiedOperateInvDateModel);
    if (!dateModel) continue;
    const ranges = dateModel.modifyDates;
    if (!Array.isArray(ranges)) continue;

    // 周次档是数组，各档可配不同星期 + 不同参数（样本：[1,2,3,4,7] 开房、[5,6] 关房）。
    // 回读只关心「读哪些天」，不关心各档改成什么 —— 取**并集**。
    const weekParams = Array.isArray(dateModel.modifyParamByEffectWeeks)
      ? dateModel.modifyParamByEffectWeeks
      : [];
    let union: Set<number> | null = new Set();
    for (const rawParam of weekParams) {
      const param = asObject(rawParam);
      // 档本身不是对象 —— 形状不符，与 effectWeek 非法同等对待。
      if (!param) return null;
      const parsed = weekdaysFromInts(param.effectWeek);
      // ⚠️ 形状不符 → **整次放弃回读**，不退化成不过滤（那是多读）也不当空集（那是漏报）。
      if (parsed.kind === 'malformed') return null;
      // 任一档「不过滤」，并集即全集 —— 后续档不必再看。
      if (parsed.kind === 'all') {
        union = null;
        break;
      }
      for (const d of parsed.days) union.add(d);
    }
    // 一个档都没有 → 不过滤（没有星期概念）。
    if (union !== null && union.size === 0) union = null;

    roomIds.push(...dayRoomIds);
    dates.push(...expandRanges(ranges, union));
  }

  // ⚠️ 空集合必须显式挡掉：既不能退化成「回读全部房型」，也不能发一个空请求让它静默成功
  // —— 那种哑弹在日志上与「一切正常」长得一样。判据覆盖空值本身，不写成 `if (a && b)`。
  if (roomIds.length === 0 || dates.length === 0) return null;

  return {
    roomIds: uniqueSortedNumbers(roomIds),
    dates: uniqueSortedStrings(dates),
    poiId: poiIdText,
    partnerId,
  };
}
