import { describe, expect, it } from 'vitest';
import {
  CTRIP_ROOM_STATUS_ENDPOINT_ID,
  CTRIP_ROOM_STATUS_QUANTITY_ENDPOINT_ID,
  extractCtripReadbackTargets,
} from '../../../src/main/channels/ctrip/room-change-targets';
import type { JsonObject } from '../../../src/shared/types/json';

const WINDOW_DAYS = 7;
// 2026-08-31 是**周一** —— 下面按星期断言的用例都依赖这个事实。
const TODAY = new Date(2026, 7, 31);

function calendar(raw: JsonObject) {
  return extractCtripReadbackTargets(CTRIP_ROOM_STATUS_ENDPOINT_ID, raw, WINDOW_DAYS, TODAY);
}
function batch(raw: JsonObject) {
  return extractCtripReadbackTargets(
    CTRIP_ROOM_STATUS_QUANTITY_ENDPOINT_ID,
    raw,
    WINDOW_DAYS,
    TODAY,
  );
}

describe('extractCtripReadbackTargets — 日历页', () => {
  it('单房型单日', () => {
    // 踩点 `日历页面-房量.md` 的形状（holidyInfo 已由既有裁剪剔除）。
    expect(
      calendar({
        hotelRoomInfoDtoList: [{ hotelID: 124241180, roomTypeID: 1602330634, roomName: 'x' }],
        dateItemInfoDtoList: [{ startDate: '2026-10-19', endDate: '2026-10-19' }],
        weekDayIndex: '1111111',
      }),
    ).toEqual({ roomTypeIds: [1602330634], dates: ['2026-10-19'], truncated: false });
  });

  it('跨门店多房型全部保留', () => {
    // 真实样本 `日历菜单-价量态修改踩点.md:165`：6 个房型分属两家门店。
    const rooms = [1569052067, 1569052724, 1569052824].map((id) => ({
      hotelID: 122247738,
      roomTypeID: id,
    }));
    const rooms2 = [1602330530, 1602330627, 1602330628].map((id) => ({
      hotelID: 124241180,
      roomTypeID: id,
    }));

    const result = calendar({
      hotelRoomInfoDtoList: [...rooms, ...rooms2],
      dateItemInfoDtoList: [{ startDate: '2026-08-31', endDate: '2026-08-31' }],
      weekDayIndex: '1111111',
    });

    expect(result?.roomTypeIds).toEqual([
      1569052067, 1569052724, 1569052824, 1602330530, 1602330627, 1602330628,
    ]);
  });

  it('忽略 originalRoomProductIds，只认 hotelRoomInfoDtoList', () => {
    const result = calendar({
      hotelRoomInfoDtoList: [{ hotelID: 1, roomTypeID: 111 }],
      // 故意放一个不同的 ID：若实现取了并集，这里会多出 999。
      originalRoomProductIds: [999],
      dateItemInfoDtoList: [{ startDate: '2026-08-31', endDate: '2026-08-31' }],
      weekDayIndex: '1111111',
    });

    expect(result?.roomTypeIds).toEqual([111]);
  });

  it('多日区间逐日展开（闭区间，两端都含）', () => {
    const result = calendar({
      hotelRoomInfoDtoList: [{ roomTypeID: 1 }],
      dateItemInfoDtoList: [{ startDate: '2026-08-31', endDate: '2026-09-02' }],
      weekDayIndex: '1111111',
    });

    expect(result?.dates).toEqual(['2026-08-31', '2026-09-01', '2026-09-02']);
  });
});

describe('extractCtripReadbackTargets — 星期过滤（守 design 决策 4.1）', () => {
  // 多报的日期会被服务端当成要跟价的目标跟到抖音去 —— 不是冗余，是擅自扩大改动范围。
  const week = { startDate: '2026-08-31', endDate: '2026-09-06' }; // 周一~周日

  it('位串 "0000110" 只剩周五周六', () => {
    // 真实样本 `日历菜单-价量态修改踩点.md:25`：顶层 "weekend":"0000110"。
    // ⚠️ 携程把**周五周六**算作 weekend（酒店业口径，周末含周五晚），不是周六周日。
    const result = calendar({
      hotelRoomInfoDtoList: [{ roomTypeID: 1 }],
      dateItemInfoDtoList: [week],
      weekDayIndex: '0000110',
    });

    expect(result?.dates).toEqual(['2026-09-04', '2026-09-05']);
  });

  it('位串 "1111001" 是上一条的互补，合起来正好是整区间', () => {
    // 服务端 `RawBodyReader.weekdaysFromBitString` 的注释样本：→ [1,2,3,4,7]。
    const result = calendar({
      hotelRoomInfoDtoList: [{ roomTypeID: 1 }],
      dateItemInfoDtoList: [week],
      weekDayIndex: '1111001',
    });

    expect(result?.dates).toEqual([
      '2026-08-31', // 一
      '2026-09-01', // 二
      '2026-09-02', // 三
      '2026-09-03', // 四
      '2026-09-06', // 日
    ]);
  });

  // ⭐ 唯一能抓住位序写反的用例：对称样本（如 "1111111"）在左右颠倒时照样绿。
  it('位序最左是周一，不是周日', () => {
    const result = calendar({
      hotelRoomInfoDtoList: [{ roomTypeID: 1 }],
      dateItemInfoDtoList: [week],
      weekDayIndex: '1000000',
    });

    expect(result?.dates).toEqual(['2026-08-31']); // 周一，不是周日的 09-06
  });

  it('批量页 ["SATURDAY"] 只剩周六', () => {
    // 真实样本 `改价03..md`。
    const result = batch({
      roomProductIds: ['1'],
      dates: { dateRanges: [week], weekDays: ['SATURDAY'], applyAllDates: false },
    });

    expect(result?.dates).toEqual(['2026-09-05']);
  });

  it('批量页 ["FRIDAY","SATURDAY"] 只剩周五六', () => {
    // 真实样本 `房价维护菜单踩点.md`。
    const result = batch({
      roomProductIds: ['1'],
      dates: { dateRanges: [week], weekDays: ['FRIDAY', 'SATURDAY'], applyAllDates: false },
    });

    expect(result?.dates).toEqual(['2026-09-04', '2026-09-05']);
  });

  it('批量页空 weekDays 视为不过滤', () => {
    // 真实样本 `改价踩点2.md:117` 的 "weekDays":[]。与服务端 toDayOfWeek 口径一致。
    const result = batch({
      roomProductIds: ['1'],
      dates: { dateRanges: [week], weekDays: [], applyAllDates: false },
    });

    expect(result?.dates).toHaveLength(7);
  });

  it('weekDayIndex 缺失或形状不合预期时不过滤', () => {
    for (const bits of [undefined, '', '111', '11111112', 123]) {
      const result = calendar({
        hotelRoomInfoDtoList: [{ roomTypeID: 1 }],
        dateItemInfoDtoList: [week],
        ...(bits === undefined ? {} : { weekDayIndex: bits }),
      } as JsonObject);
      expect(result?.dates).toHaveLength(7);
    }
  });
});

describe('extractCtripReadbackTargets — 批量页', () => {
  it('roomProductIds 是字符串数组，转成数字', () => {
    // 真实样本 `房态房量菜单.md`。
    const result = batch({
      roomProductIds: ['1602330530', '1569052068'],
      dates: {
        dateRanges: [{ startDate: '2026-08-27', endDate: '2026-08-28' }],
        weekDays: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
        applyAllDates: false,
      },
    });

    expect(result).toEqual({
      roomTypeIds: [1569052068, 1602330530],
      dates: ['2026-08-27', '2026-08-28'],
      truncated: false,
    });
  });

  it('applyAllDates 为真时裁剪到窗口并标记 truncated', () => {
    const result = batch({
      roomProductIds: ['1'],
      dates: {
        dateRanges: [{ startDate: '2026-08-31', endDate: '2028-08-31' }],
        weekDays: ['SATURDAY'],
        applyAllDates: true,
      },
    });

    expect(result?.truncated).toBe(true);
    expect(result?.dates).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
  });

  it('applyAllDates 的窗口跟随入参，不硬编码 7', () => {
    const result = extractCtripReadbackTargets(
      CTRIP_ROOM_STATUS_QUANTITY_ENDPOINT_ID,
      { roomProductIds: ['1'], dates: { applyAllDates: true } },
      3,
      TODAY,
    );

    expect(result?.dates).toEqual(['2026-08-31', '2026-09-01', '2026-09-02']);
  });
});

describe('extractCtripReadbackTargets — 不回读的情形', () => {
  it('改价端点返回 null', () => {
    expect(
      extractCtripReadbackTargets(
        'batchsetroomprice',
        { roomPriceInfoList: [{ roomTypeID: 1 }] },
        WINDOW_DAYS,
        TODAY,
      ),
    ).toBeNull();
  });

  it('房型为空数组返回 null，不得退化为全量', () => {
    expect(
      calendar({
        hotelRoomInfoDtoList: [],
        dateItemInfoDtoList: [{ startDate: '2026-08-31', endDate: '2026-08-31' }],
      }),
    ).toBeNull();
    expect(
      batch({
        roomProductIds: [],
        dates: { dateRanges: [{ startDate: '2026-08-31', endDate: '2026-08-31' }] },
      }),
    ).toBeNull();
  });

  it('日期为空返回 null', () => {
    expect(calendar({ hotelRoomInfoDtoList: [{ roomTypeID: 1 }], dateItemInfoDtoList: [] })).toBeNull();
  });

  it('日期字段缺失或形状不符返回 null', () => {
    expect(calendar({ hotelRoomInfoDtoList: [{ roomTypeID: 1 }] })).toBeNull();
    expect(batch({ roomProductIds: ['1'] })).toBeNull();
  });

  it('起止颠倒的区间被跳过', () => {
    expect(
      calendar({
        hotelRoomInfoDtoList: [{ roomTypeID: 1 }],
        dateItemInfoDtoList: [{ startDate: '2026-09-06', endDate: '2026-08-31' }],
      }),
    ).toBeNull();
  });
});
