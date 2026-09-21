/**
 * 从携程房态房量改动的 `changeRaw` 还原「本次改动影响了哪些房型、哪些日期」—— 回读的输入。
 *
 * **本文件是 `ctrip/` 的内部实现**，不出现在 `channels/types.ts` 的任何跨渠道接口上：
 * 「要不要回读、读哪些房型日期」是渠道自己的事，机制层不认识端点名（见 design 决策 1.1）。
 *
 * ## 入参是 `changeRaw` 而非原始请求体
 *
 * `changeRaw` 是既有 `parse` 产出的「剔掉框架噪音的完整请求体」，回读需要的字段一个都没少
 * （已核实：两个裁剪函数都是反向白名单，只剔 `reqHead`/`cipher`/`head`/`holidyInfo`）。
 * 复用它还顺带白捡了三件事：`isSuccessful` 已判过、房型取不到时 `parse` 已返回 null、
 * 请求体已裁剪 —— 都不必再写一遍。
 *
 * ## ⚠️ 精确还原，既不能漏也不能多
 *
 * 服务端拿回读结果去**追价**。多报的日期会被当成需要跟的目标跟到抖音去 —— 那不是冗余，
 * 是**擅自扩大用户的改动范围**。所以星期筛选必须参与展开，不能用「宁可多读」兜底。
 *
 * ## 两个端点的字段零同名
 *
 * ```
 *              日历页 setbatchroombookablestatus   批量页 batchUpdateRoomStatusAndQuantity
 * 房型         hotelRoomInfoDtoList[].roomTypeID   roomProductIds[]        ⚠️ 字符串
 * 日期         dateItemInfoDtoList[]               dates.dateRanges[]
 * 星期         weekDayIndex "1111111" 位串          dates.weekDays[] 英文枚举
 * 全部日期     无                                   dates.applyAllDates
 * ```
 */
import type { JsonObject } from '../../../shared/types/json';

/** 回读的目标。`dates` 已经是**交集展开后的具体日期**，不再含星期概念。 */
export type ReadbackTargets = Readonly<{
  roomTypeIds: readonly number[];
  /** 升序、去重、`YYYY-MM-DD`。 */
  dates: readonly string[];
  /** 因 `applyAllDates` 被裁剪到配置窗口 —— 上报的不是完整快照。 */
  truncated: boolean;
}>;

export const CTRIP_ROOM_STATUS_ENDPOINT_ID = 'setbatchroombookablestatus';
export const CTRIP_ROOM_STATUS_QUANTITY_ENDPOINT_ID = 'batchUpdateRoomStatusAndQuantity';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 星期位串 → ISO 星期数集合。`"1111001"` → `{1,2,3,4,7}`。
 *
 * ⚠️ **最左是周一**（ISO 序），与服务端 `RawBodyReader.weekdaysFromBitString` 同口径。
 * 两边算出不同的日期集合会让「服务端跟的」与「desktop 报的」对不上，且失效是静默错跟。
 *
 * 形状不合预期（长度不是 7、含非 0/1 字符）时返回 `null` = 不过滤。宁可多读也不能在这里
 * 猜 —— 猜错会漏读，而漏读是静默的。
 */
function weekdaysFromBitString(bits: unknown): ReadonlySet<number> | null {
  if (typeof bits !== 'string') return null;
  const s = bits.trim();
  if (s.length !== 7 || !/^[01]{7}$/.test(s)) return null;
  const days = new Set<number>();
  for (let i = 0; i < 7; i += 1) {
    if (s[i] === '1') days.add(i + 1);
  }
  // 全 0 视为「没有任何一天生效」在业务上讲不通，按不过滤处理（与空串同义）。
  return days.size === 0 ? null : days;
}

const WEEKDAY_NAME_TO_ISO: ReadonlyMap<string, number> = new Map([
  ['MONDAY', 1],
  ['TUESDAY', 2],
  ['WEDNESDAY', 3],
  ['THURSDAY', 4],
  ['FRIDAY', 5],
  ['SATURDAY', 6],
  ['SUNDAY', 7],
]);

/**
 * 英文枚举 → ISO 星期数集合。`["SATURDAY"]` → `{6}`。
 *
 * 与服务端 `RawBodyReader.weekdaysFromNames` 同口径。空数组 = 不过滤（`null`），与服务端
 * `toDayOfWeek` 的 `if (weekdays.isEmpty()) return 全部` 一致 —— 踩点里有 `"weekDays":[]`
 * 的真实样本。
 */
function weekdaysFromNames(names: unknown): ReadonlySet<number> | null {
  if (!Array.isArray(names) || names.length === 0) return null;
  const days = new Set<number>();
  for (const name of names) {
    if (typeof name !== 'string') continue;
    const iso = WEEKDAY_NAME_TO_ISO.get(name.trim().toUpperCase());
    if (iso !== undefined) days.add(iso);
  }
  return days.size === 0 ? null : days;
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

/**
 * 把 `[{startDate, endDate}]` 区间数组展开成日期列表，并按星期集合过滤。
 *
 * 区间是**闭区间**（两端都含）。起止颠倒或日期不合法的项跳过 —— 不猜用户意图。
 */
function expandRanges(
  ranges: readonly unknown[],
  weekdays: ReadonlySet<number> | null,
): string[] {
  const dates: string[] = [];
  for (const range of ranges) {
    if (typeof range !== 'object' || range === null || Array.isArray(range)) continue;
    const start = parseIsoDate((range as JsonObject).startDate);
    const end = parseIsoDate((range as JsonObject).endDate);
    if (!start || !end || start.getTime() > end.getTime()) continue;

    for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
      const day = new Date(t);
      if (weekdays !== null && !weekdays.has(isoWeekday(day))) continue;
      dates.push(toIsoDate(day));
    }
  }
  return dates;
}

/** 从今日起连续 `days` 天（含今日）。`applyAllDates` 的裁剪窗口。 */
function nextNDays(today: Date, days: number): string[] {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dates: string[] = [];
  for (let i = 0; i < days; i += 1) {
    dates.push(toIsoDate(new Date(base.getTime() + i * MS_PER_DAY)));
  }
  return dates;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // 批量页的 roomProductIds 是**字符串**数组，必须转。
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return value.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  return null;
}

function uniqueSorted<T>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function finish(roomTypeIds: number[], dates: string[], truncated: boolean): ReadbackTargets | null {
  // ⚠️ 空集合必须显式挡掉：既不能退化成「回读全部房型」，也不能发一个空请求让它静默成功
  // —— 那种哑弹在日志上与「一切正常」长得一样。
  if (roomTypeIds.length === 0 || dates.length === 0) return null;
  return {
    roomTypeIds: uniqueSorted(roomTypeIds),
    dates: uniqueSorted(dates),
    truncated,
  };
}

/**
 * @param applyAllDatesReadbackDays `applyAllDates` 时的裁剪窗口，**入参**（来自 appConfig，不硬编码）
 * @param today      **入参**，不读全局时钟 —— 否则这个函数不可测
 * @returns `null` = 本次改动不需要回读（不是房量端点、房型或日期为空）
 */
export function extractCtripReadbackTargets(
  endpointId: string,
  changeRaw: JsonObject,
  applyAllDatesReadbackDays: number,
  today: Date,
): ReadbackTargets | null {
  if (endpointId === CTRIP_ROOM_STATUS_ENDPOINT_ID) {
    const rooms = changeRaw.hotelRoomInfoDtoList;
    if (!Array.isArray(rooms)) return null;
    // 只用 hotelRoomInfoDtoList，忽略 originalRoomProductIds：两者在样本里值恒等，但前者
    // 每项自带 hotelID，跨门店样本里只有它能区分归属（design 决策 3.1）。
    const roomTypeIds = rooms
      .map((r) =>
        typeof r === 'object' && r !== null && !Array.isArray(r)
          ? toFiniteNumber((r as JsonObject).roomTypeID)
          : null,
      )
      .filter((id): id is number => id !== null);

    const ranges = changeRaw.dateItemInfoDtoList;
    if (!Array.isArray(ranges)) return null;
    const dates = expandRanges(ranges, weekdaysFromBitString(changeRaw.weekDayIndex));
    return finish(roomTypeIds, dates, false);
  }

  if (endpointId === CTRIP_ROOM_STATUS_QUANTITY_ENDPOINT_ID) {
    const ids = changeRaw.roomProductIds;
    if (!Array.isArray(ids)) return null;
    const roomTypeIds = ids.map(toFiniteNumber).filter((id): id is number => id !== null);

    const datesField = changeRaw.dates;
    if (typeof datesField !== 'object' || datesField === null || Array.isArray(datesField)) {
      return null;
    }
    const d = datesField as JsonObject;

    // 「应用到所有日期」：携程会改从今日起约两年，且改变未显式设置过的日期的默认值。
    // 那个集合客户端算不出来 —— 裁剪到配置窗口，并标记 truncated（design 决策 4.2）。
    if (d.applyAllDates === true) {
      return finish(roomTypeIds, nextNDays(today, applyAllDatesReadbackDays), true);
    }

    const ranges = d.dateRanges;
    if (!Array.isArray(ranges)) return null;
    return finish(roomTypeIds, expandRanges(ranges, weekdaysFromNames(d.weekDays)), false);
  }

  // 改价等其他端点 —— 不回读。
  return null;
}
