import { describe, expect, it } from 'vitest';
import { toCtripRoomStatusRaw } from '../../../src/main/channels/ctrip/room-status-payload';

/**
 * 请求体取自踩点 `docs/踩点/携程/房量01.md` 的「关房」那份 curl，一字未改。
 * 开房那份与它只差 `roomStatus`（`"N"` → `"G"`），所以形状测试用一份即可。
 */
const REAL_CLOSE_ROOM_BODY = {
  hotelRoomInfoDtoList: [
    {
      hotelID: 115348672,
      roomTypeID: 1587157431,
      roomName: '&#24742;&#20139;&#22823;&#24202;&#25151;&lt;&#21333;&#26089;&gt;',
    },
  ],
  dateItemInfoDtoList: [
    {
      startDate: '2026-08-31',
      endDate: '2026-08-31',
      holidyInfo: [
        { name: '中秋节', startDate: '2026-09-24', endDate: '2026-09-27', activeFlag: false, published: true },
        { name: '国庆节', startDate: '2026-09-30', endDate: '2026-10-07', activeFlag: false, published: true },
        { name: '元旦节', startDate: '2026-12-31', endDate: '2027-01-01', activeFlag: false, published: false },
        { name: '春节', startDate: '2027-02-05', endDate: '2027-02-06', activeFlag: false, published: false },
        { name: '清明节', startDate: '2027-04-04', endDate: '2027-04-05', activeFlag: false, published: false },
      ],
    },
  ],
  weekDayIndex: '1111111',
  pageType: 'F',
  processType: 3,
  roomStatus: 'N',
  originalRoomProductIds: [1587157431],
};

describe('携程房态 changeRaw 模型', () => {
  it('剔除 holidyInfo 节假日字典，日期字段原样保留', () => {
    const raw = toCtripRoomStatusRaw(REAL_CLOSE_ROOM_BODY);

    expect(raw.dateItemInfoDtoList).toEqual([{ startDate: '2026-08-31', endDate: '2026-08-31' }]);
  });

  /**
   * `roomStatus` 是**开关房的唯一依据**（开房那份 curl 与关房只差这一个字段）。
   * 丢了它 RMS 就分不出用户是开房还是关房，把关房当开房处理会造成超售。
   */
  it('保留 roomStatus —— 这是区分开房与关房的唯一字段', () => {
    expect(toCtripRoomStatusRaw(REAL_CLOSE_ROOM_BODY).roomStatus).toBe('N');
    expect(toCtripRoomStatusRaw({ ...REAL_CLOSE_ROOM_BODY, roomStatus: 'G' }).roomStatus).toBe('G');
  });

  /** 除 holidyInfo 外一律原样 —— 含语义未知的 pageType/processType，看不懂不等于该丢。 */
  it('其余字段一字不改地保留', () => {
    const raw = toCtripRoomStatusRaw(REAL_CLOSE_ROOM_BODY);

    expect(raw).toEqual({ ...REAL_CLOSE_ROOM_BODY, dateItemInfoDtoList: [{ startDate: '2026-08-31', endDate: '2026-08-31' }] });
  });

  it('没有 dateItemInfoDtoList 时原样返回', () => {
    const body = { roomStatus: 'G', hotelRoomInfoDtoList: [{ hotelID: 1 }] };

    expect(toCtripRoomStatusRaw(body)).toEqual(body);
  });

  /** 形状不合预期时不该顺手改写，交给 RMS 看到原文。 */
  it('dateItemInfoDtoList 里的非对象元素原样放回', () => {
    const raw = toCtripRoomStatusRaw({ dateItemInfoDtoList: ['unexpected', 42] });

    expect(raw.dateItemInfoDtoList).toEqual(['unexpected', 42]);
  });
});
