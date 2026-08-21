import { describe, expect, it } from 'vitest';
import { toCtripRoomStatusQuantityRaw } from '../../../src/main/channels/ctrip/room-status-quantity-payload';

/**
 * 请求体取自踩点 `docs/踩点/携程/房态房量菜单.md` 的「开房」那份 curl（`reqHead` 的冗长
 * 埋点内容做了删减，其余一字未改）。关房那份与它**只差 `roomStatus`**（`1` → `2`），
 * 所以形状测试用一份即可。
 */
const REAL_OPEN_ROOM_BODY = {
  reqHead: {
    host: 'ebooking.ctrip.com',
    pathName: '/rateplan/batchSetRoomStatusAndQuantity',
    locale: 'zh-CN',
    client: { deviceType: 'PC', os: 'Mac', screenWidth: 1512, screenHeight: 982 },
    ubt: { pageid: '10650010598', vid: '1783671354944.b258HpfnRYwb' },
  },
  roomProductIds: ['1602330530', '1569052068'],
  dates: {
    dateRanges: [{ startDate: '2026-08-27', endDate: '2026-08-28' }],
    weekDays: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
    applyAllDates: false,
  },
  roomStatus: 1,
  roomQuantityLimitType: -100,
  remainRoomQuantityType: -100,
  syncRoomQuantityWithSharedInventory: true,
  cipher: {
    '1569052068': 'AAEAAQAPMTU2OTA1MjA2OCxodWlklGbD4NMmbZPOr4uXhGW8bBS-t_6TmEU9RCadTCjTB3g=-tripsign',
    '1602330530': 'AAEAAQAPMTYwMjMzMDUzMCxodWlkCK4FBy3mcId2G9ouaoPBkOFindxHZEByGfyQpv5Jmiw=-tripsign',
  },
  head: {
    cid: '09031162210038262124',
    ctok: '',
    cver: '1.0',
    lang: '01',
    sid: '8888',
    syscode: '09',
    auth: '',
    xsid: '',
    extension: [],
  },
};

describe('toCtripRoomStatusQuantityRaw', () => {
  /**
   * 三个 SOA 框架字段都含隐私或凭证内容：`reqHead` 有设备指纹（分辨率、UA、IP），
   * `cipher` 是每个房型的 tripsign 签名，`head` 里有 `auth`。与改价新模块同一口径。
   */
  it('剔除 reqHead / cipher / head 三个框架噪音字段', () => {
    const raw = toCtripRoomStatusQuantityRaw(REAL_OPEN_ROOM_BODY);

    expect(raw).not.toHaveProperty('reqHead');
    expect(raw).not.toHaveProperty('cipher');
    expect(raw).not.toHaveProperty('head');
  });

  /** 剔完之后剩下的就是 RMS 实际会收到的 `changeRaw`，逐字段钉住。 */
  it('业务字段全部原样保留', () => {
    const raw = toCtripRoomStatusQuantityRaw(REAL_OPEN_ROOM_BODY);

    expect(raw).toEqual({
      roomProductIds: ['1602330530', '1569052068'],
      dates: {
        dateRanges: [{ startDate: '2026-08-27', endDate: '2026-08-28' }],
        weekDays: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
        applyAllDates: false,
      },
      roomStatus: 1,
      roomQuantityLimitType: -100,
      remainRoomQuantityType: -100,
      syncRoomQuantityWithSharedInventory: true,
    });
  });

  /**
   * ⚠️ 房量三字段本次 RMS **不解析**，但 desktop 照常透传 —— 透传是既定语义，不因为
   * 「下游暂时不用」就剔掉（剔了以后要用就永久丢失了）。
   * ⚠️ `-100` 疑为「本次不改房量」的哨兵值，RMS 不得当作真实房量写入台账。
   */
  it('房量三字段虽不被下游解析，仍原样透传', () => {
    const raw = toCtripRoomStatusQuantityRaw(REAL_OPEN_ROOM_BODY);

    expect(raw.roomQuantityLimitType).toBe(-100);
    expect(raw.remainRoomQuantityType).toBe(-100);
    expect(raw.syncRoomQuantityWithSharedInventory).toBe(true);
  });

  /**
   * `dates` 是嵌套对象，裁剪只做顶层浅层剔除，不该顺手动它内部。
   * ⚠️ `applyAllDates` 语义未证实（两份样本都是 false），更要原样带走。
   */
  it('嵌套的 dates 不被改写', () => {
    const raw = toCtripRoomStatusQuantityRaw(REAL_OPEN_ROOM_BODY);

    expect(raw.dates).toEqual(REAL_OPEN_ROOM_BODY.dates);
  });

  /**
   * ⚠️ 开关房只差这一个字段，且**不归一化**成日历菜单端点那套 `"G"`/`"N"` ——
   * 归一化属于语义转换，RMS 按 endpointId 自己解读。判反了会造成超售。
   */
  it('开房 1 与关房 2 原样保留，不归一化', () => {
    const open = toCtripRoomStatusQuantityRaw(REAL_OPEN_ROOM_BODY);
    const close = toCtripRoomStatusQuantityRaw({ ...REAL_OPEN_ROOM_BODY, roomStatus: 2 });

    expect(open.roomStatus).toBe(1);
    expect(close.roomStatus).toBe(2);
    // 除 roomStatus 外两者完全一致（踩点两份 curl 全量 diff 只差这一处）。
    expect({ ...open, roomStatus: undefined }).toEqual({ ...close, roomStatus: undefined });
  });

  /**
   * 透传原则：语义未知的字段不能因为「看不懂」就丢。携程随时可能加字段，加了就被静默
   * 丢弃是最难查的失效方式。
   */
  it('语义未知的新增字段一律保留', () => {
    const raw = toCtripRoomStatusQuantityRaw({
      ...REAL_OPEN_ROOM_BODY,
      someFutureCtripField: 'X',
    });

    expect(raw.someFutureCtripField).toBe('X');
  });
});
