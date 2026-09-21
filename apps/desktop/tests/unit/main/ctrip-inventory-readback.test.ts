import { describe, expect, it, vi } from 'vitest';
import { createCtripInventoryReadback } from '../../../src/main/channels/ctrip/inventory-readback';
import type { CtripReadbackFetcher } from '../../../src/main/channels/ctrip/inventory-readback';
import { toChannelId } from '../../../src/main/ids';
import type { OtaAmountChangeObserved } from '../../../src/shared/types/amount-change';
import type { JsonObject } from '../../../src/shared/types/json';
import type { WebContents } from 'electron';

const CTRIP = toChannelId('ctrip');
const TODAY = new Date(2026, 7, 31); // 周一
const CONFIG = { applyAllDatesReadbackDays: 7, timeoutMs: 30_000 };

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const FAKE_WC = {} as WebContents;

/** 批量页的改动上报体（既有 parse 的产出）。 */
function batchReport(changeRaw: JsonObject): OtaAmountChangeObserved {
  return {
    source: CTRIP,
    changeType: 'roomStatus',
    endpointId: 'batchUpdateRoomStatusAndQuantity',
    endpointUrl: 'https://ebooking.ctrip.com/restapi/soa2/23783/batchUpdateRoomStatusAndQuantity',
    otaHotelId: '',
    changeRaw,
  };
}

const ONE_DAY_CHANGE: JsonObject = {
  roomProductIds: ['1569052069'],
  dates: {
    dateRanges: [{ startDate: '2026-10-20', endDate: '2026-10-20' }],
    weekDays: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
    applyAllDates: false,
  },
  roomStatus: -100,
  roomQuantityLimitType: 1,
  remainRoomQuantityType: 11,
  remainRoomQuantity: 2,
};

/** getRcProductList 的成功响应。 */
function productList(rooms: JsonObject[]): JsonObject {
  return { code: 200, data: [{ roomInfos: rooms }] };
}

function room(id: number, extra: JsonObject = {}): JsonObject {
  return {
    hotelID: 122247738,
    roomTypeID: id,
    roomName: '云境尊享套房',
    payType: 'PP',
    roomClass: id,
    rateCodeID: 999,
    ...extra,
  };
}

/** getRoomInventoryInfo 的成功响应。 */
function inventory(rows: JsonObject[]): JsonObject {
  return { code: 200, data: { roomStatusResult: rows } };
}

function cell(roomTypeID: number, effectDate: string, extra: JsonObject = {}): JsonObject {
  return {
    hotelID: 122247738,
    roomTypeID,
    effectDate,
    payType: 'PP',
    roomStatus: 'G',
    limitSale: 'T',
    freeSale: 'F',
    totalQuantity: 6,
    canUsedQuantity: 6,
    hasInventory: true,
    ...extra,
  };
}

/** 依次返回预设响应的 fetcher，并记录每次请求。 */
function fetcherOf(...responses: unknown[]) {
  const calls: { url: string; body: JsonObject }[] = [];
  const fetcher: CtripReadbackFetcher = async (_wc, url, body) => {
    calls.push({ url, body });
    return responses[calls.length - 1];
  };
  return { fetcher, calls };
}

function create(fetcher: CtripReadbackFetcher, logger = createLogger()) {
  return {
    readback: createCtripInventoryReadback({
      logger,
      fetcher,
      config: () => CONFIG,
      now: () => TODAY,
    }),
    logger,
  };
}

describe('createCtripInventoryReadback — 成功路径', () => {
  it('两步请求后产出上报体', async () => {
    const { fetcher, calls } = fetcherOf(
      productList([room(1569052069)]),
      inventory([cell(1569052069, '2026-10-20')]),
    );
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;

    expect(outcome.report.changeType).toBe('inventoryReadback');
    // ⚠️ endpointId 是**回读端点**，不是触发它的写端点 —— 后者已被既有 Translator 认领。
    expect(outcome.report.endpointId).toBe('getRoomInventoryInfo');
    // otaHotelId 留空由 service 层用 masterHotelId 归一，绝不取回读响应里的 hotelID。
    expect(outcome.report.otaHotelId).toBe('');

    const raw = outcome.report.changeRaw as JsonObject;
    expect(raw.cells).toHaveLength(1);
    expect((raw.trigger as JsonObject).endpointId).toBe('batchUpdateRoomStatusAndQuantity');

    // 第一步 body 恒为 {} —— 门店上下文完全由 cookie 决定。
    expect(calls[0].body).toEqual({});
    expect(calls[1].body.startDate).toBe('2026-10-20');
    expect(calls[1].body.endDate).toBe('2026-10-20');
  });

  it('rawRequest 与触发它的 changeRaw 是同一份，不另行裁剪', async () => {
    const { fetcher } = fetcherOf(
      productList([room(1569052069)]),
      inventory([cell(1569052069, '2026-10-20')]),
    );
    const { readback } = create(fetcher);
    const trigger = batchReport(ONE_DAY_CHANGE);

    const outcome = await readback.readback(trigger, FAKE_WC);
    if (outcome.kind !== 'ok') throw new Error('expected ok');

    const raw = outcome.report.changeRaw as JsonObject;
    expect((raw.trigger as JsonObject).rawRequest).toEqual(trigger.changeRaw);
  });

  it('cells 原样透传，不做枚举映射或类型转换', async () => {
    const original = cell(1569052069, '2026-10-20', {
      roomStatus: 'Y', // 手动关房 —— 不得被转成 CLOSED
      limitSale: 'F',
      freeSale: 'T',
      totalQuantity: 0, // ⚠️ FreeSale 时 0 不代表没房
    });
    const { fetcher } = fetcherOf(productList([room(1569052069)]), inventory([original]));
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);
    if (outcome.kind !== 'ok') throw new Error('expected ok');

    const cells = (outcome.report.changeRaw as JsonObject).cells as JsonObject[];
    expect(cells[0]).toEqual(original);
  });

  it('cells 为空是合法结果，不是失败', async () => {
    const { fetcher } = fetcherOf(productList([room(1569052069)]), inventory([]));
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect((outcome.report.changeRaw as JsonObject).cells).toEqual([]);
  });

  it('房量与房态整行照报，不因「只改了房量」而裁掉房态', async () => {
    const { fetcher } = fetcherOf(
      productList([room(1569052069)]),
      inventory([cell(1569052069, '2026-10-20')]),
    );
    const { readback } = create(fetcher);

    // ONE_DAY_CHANGE 是「房量 +2」（roomStatus: -100 表示房态不变）。
    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);
    if (outcome.kind !== 'ok') throw new Error('expected ok');

    const cells = (outcome.report.changeRaw as JsonObject).cells as JsonObject[];
    expect(cells[0].roomStatus).toBe('G'); // 房态仍在
    expect(cells[0].totalQuantity).toBe(6); // 房量也在
  });
});

describe('createCtripInventoryReadback — 日期精确性（守 design 决策 4.1.1）', () => {
  it('目标日期不连续时，请求按 min~max 发但只上报目标日期', async () => {
    // 用户改了 8/31~9/6 区间里的周五周六（"0000110" 位串在日历页的等价表达）。
    const change: JsonObject = {
      roomProductIds: ['1'],
      dates: {
        dateRanges: [{ startDate: '2026-08-31', endDate: '2026-09-06' }],
        weekDays: ['FRIDAY', 'SATURDAY'],
        applyAllDates: false,
      },
    };
    // 渠道会把区间内 7 天全返回。
    const allWeek = [
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ].map((d) => cell(1, d));

    const { fetcher, calls } = fetcherOf(productList([room(1)]), inventory(allWeek));
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(change), FAKE_WC);
    if (outcome.kind !== 'ok') throw new Error('expected ok');

    // 请求覆盖整个区间（接口不支持星期过滤）
    expect(calls[1].body.startDate).toBe('2026-09-04');
    expect(calls[1].body.endDate).toBe('2026-09-05');

    // ⭐ 但上报只有目标日期 —— 多报会让服务端多跟价
    const cells = (outcome.report.changeRaw as JsonObject).cells as JsonObject[];
    expect(cells.map((c) => c.effectDate)).toEqual(['2026-09-04', '2026-09-05']);
  });

  it('applyAllDates 时裁剪到窗口并标记 truncated', async () => {
    const change: JsonObject = {
      roomProductIds: ['1'],
      dates: { dateRanges: [{ startDate: '2026-08-31', endDate: '2028-08-31' }], applyAllDates: true },
    };
    const week = [
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ].map((d) => cell(1, d));

    const { fetcher } = fetcherOf(productList([room(1)]), inventory(week));
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(change), FAKE_WC);
    if (outcome.kind !== 'ok') throw new Error('expected ok');

    const raw = outcome.report.changeRaw as JsonObject;
    // truncated 是服务端判断「数据不完整」的唯一依据 —— 渠道改了 2 年，我们只报了 7 天。
    expect(raw.truncated).toBe(true);
    expect(raw.cells).toHaveLength(7);
  });
});

describe('createCtripInventoryReadback — skipped', () => {
  it('改价端点不回读', async () => {
    const { fetcher, calls } = fetcherOf();
    const { readback } = create(fetcher);

    const outcome = await readback.readback(
      { ...batchReport({}), changeType: 'price', endpointId: 'setRCRoomPrice' },
      FAKE_WC,
    );

    expect(outcome.kind).toBe('skipped');
    expect(calls).toHaveLength(0); // 一个请求都不该发
  });

  it('房型为空时跳过，不发请求也不退化为全量', async () => {
    const { fetcher, calls } = fetcherOf();
    const { readback } = create(fetcher);

    const outcome = await readback.readback(
      batchReport({ roomProductIds: [], dates: { dateRanges: [{ startDate: '2026-10-20', endDate: '2026-10-20' }] } }),
      FAKE_WC,
    );

    expect(outcome.kind).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('目标房型不在清单里时跳过（成功但无可读内容）', async () => {
    const { fetcher } = fetcherOf(productList([room(999)])); // 清单里没有 1569052069
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);

    expect(outcome.kind).toBe('skipped');
  });

  it('钟点房与预售被源头过滤', async () => {
    const { fetcher } = fetcherOf(
      productList([room(1569052069, { hourRoom: true })]),
    );
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);

    expect(outcome.kind).toBe('skipped');
  });

  it('钟点房标记缺失或非 true 时不排除', async () => {
    const { fetcher } = fetcherOf(
      productList([room(1569052069, { hourRoom: false, advanceSale: null })]),
      inventory([cell(1569052069, '2026-10-20')]),
    );
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);

    expect(outcome.kind).toBe('ok');
  });
});

describe('createCtripInventoryReadback — 失败判定', () => {
  it.each([401, 300, -1])('body code %i 判为登录失效', async (code) => {
    const { fetcher } = fetcherOf({ code });
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);

    expect(outcome).toEqual({ kind: 'failed', reason: 'COOKIE_EXPIRED' });
  });

  it.each([
    ['islogin 标记', '<html><script>window.__INITIAL__={"isLogin":false}</script></html>'],
    ['登录页模块名', '<html><div id="htl-ebk-login-web"></div></html>'],
    ['扫码登录开关', '<html><body>qrCodeLoginSwitch=true</body></html>'],
  ])('HTTP 200 + 登录页 HTML（%s）判为登录失效', async (_name, html) => {
    const { fetcher } = fetcherOf(html);
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);

    expect(outcome).toEqual({ kind: 'failed', reason: 'COOKIE_EXPIRED' });
  });

  // ⭐ 回归守护：形态 2 靠 <title> 和域名判不出来 —— 登录页 title 是正常文案。
  it('登录页判据不依赖 title 与域名', async () => {
    const html =
      '<html><head><title>携程酒店商家管理后台</title></head>' +
      '<body><div id="htl-ebk-login-web"></div></body></html>';
    expect(html).not.toContain('passport.ctrip.com');

    const { fetcher } = fetcherOf(html);
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);
    expect(outcome).toEqual({ kind: 'failed', reason: 'COOKIE_EXPIRED' });
  });

  it('授权失败体（无 code、非 HTML）判为登录失效', async () => {
    const { fetcher } = fetcherOf({ error: 'invalid_grant', error_description: 'x' });
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);

    expect(outcome).toEqual({ kind: 'failed', reason: 'COOKIE_EXPIRED' });
  });

  // ⚠️ 403 是身份认了但没权限，重登解决不了 —— 归成 COOKIE_EXPIRED 会掩盖真因。
  it('403 单列为 FORBIDDEN，不得归为登录失效', async () => {
    const { fetcher } = fetcherOf({ __httpStatus: 403 });
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);

    expect(outcome).toEqual({ kind: 'failed', reason: 'FORBIDDEN' });
  });

  it('网络失败（null）判为 NETWORK_ERROR', async () => {
    const { fetcher } = fetcherOf(null);
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);

    expect(outcome).toEqual({ kind: 'failed', reason: 'NETWORK_ERROR' });
  });

  it('第二步失败时整体失败，不产出半份上报', async () => {
    const { fetcher } = fetcherOf(productList([room(1569052069)]), { code: 401 });
    const { readback } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);

    expect(outcome).toEqual({ kind: 'failed', reason: 'COOKIE_EXPIRED' });
  });

  it('fetcher 抛异常时判为 UNEXPECTED 而不是冒泡', async () => {
    const fetcher: CtripReadbackFetcher = async () => {
      throw new Error('boom');
    };
    const { readback, logger } = create(fetcher);

    const outcome = await readback.readback(batchReport(ONE_DAY_CHANGE), FAKE_WC);

    expect(outcome).toEqual({ kind: 'failed', reason: 'UNEXPECTED' });
    expect(logger.warn).toHaveBeenCalled();
  });
});
