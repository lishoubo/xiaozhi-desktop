import { describe, expect, it, vi } from 'vitest';
import {
  createMeituanInventoryScan,
  MEITUAN_PRICE_INVENTORY_URL,
  MEITUAN_SCAN_KIND_MARKER,
  pickMeituanRoomCatalog,
} from '../../../src/main/channels/meituan/inventory-scan';
import { flattenPriceRows } from '../../../src/main/channels/meituan/price-inventory-endpoint';
import { MEITUAN_ROOM_STATUS_URL } from '../../../src/main/channels/meituan/room-status-endpoint';
import type { ScanFetcher } from '../../../src/main/channels/types';
import type { JsonObject } from '../../../src/shared/types/json';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const PARTITION = 'persist:xiaozhi:dev:meituan:abc';
const POI_ID = '1834077877';
const PARTNER_ID = 4595635;
const EXTRA: JsonObject = { otaHotelId: POI_ID, otaPartnerId: String(PARTNER_ID) };

const OK = 10000;

/** ① 房型清单。一个物理房型下挂若干逻辑房型。 */
function roomList(logics: JsonObject[]): JsonObject {
  return {
    code: OK,
    data: { realRoomRelations: [{ realRoomId: 35549909, logicRoomRelations: logics }] },
  };
}

function logicRoom(roomId: number, roomCategory: number | undefined, goods: JsonObject[]): JsonObject {
  return {
    roomBaseInfo: { roomId, roomName: `房型${roomId}`, ...(roomCategory === undefined ? {} : { roomCategory }) },
    goodsList: goods,
  };
}

/** 默认是在售且审核通过的商品。 */
function goodsItem(goodsId: number, extra: JsonObject = {}): JsonObject {
  return { goodsId, goodsName: `商品${goodsId}`, auditStatus: 4, goodsStatus: 2, switchStatus: 0, ...extra };
}

/** ② 价格。 */
function priceResponse(items: JsonObject[]): JsonObject {
  return { code: OK, data: items };
}

function priceItem(goodsId: number, byDate: Record<string, JsonObject>): JsonObject {
  return {
    goodsBaseInfo: { goodsId, goodsName: `商品${goodsId}` },
    goodsPriceMap: Object.fromEntries(Object.entries(byDate).map(([date, cell]) => [date, [cell]])),
    // ⚠️ 同响应里带房态，但扫描刻意不读它 —— 字段集比 ③ 少两个。
    goodsStatusMap: { '2026-09-21': { date: '2026-09-21', roomStatus: 1, limitRemain: 9 } },
  };
}

/** ③ 房态房量。 */
function statusResponse(items: JsonObject[]): JsonObject {
  return { code: OK, data: items };
}

function statusItem(roomId: number, roomCategory: number, byDate: Record<string, JsonObject>): JsonObject {
  return {
    roomBaseInfo: { roomId, roomName: `房型${roomId}`, roomCategory },
    roomStatusMap: byDate,
  };
}

type Call = { url: string; body: JsonObject | null };

/** 按 URL 派发响应，并记录每次调用，便于断言入参。 */
function createFetcher(responses: Partial<Record<string, unknown>>) {
  const calls: Call[] = [];
  const fetcher: ScanFetcher = async (_partition, url, body) => {
    calls.push({ url, body });
    if (!(url in responses)) throw new Error(`unexpected url: ${url}`);
    return responses[url];
  };
  return { fetcher, calls };
}

function createScan(responses: Partial<Record<string, unknown>>, now = new Date('2026-09-21T10:00:00')) {
  const { fetcher, calls } = createFetcher(responses);
  const logger = createLogger();
  const scan = createMeituanInventoryScan({
    logger,
    fetcher,
    config: () => ({ timeoutMs: 1000 }),
    now: () => now,
  });
  return { scan, calls, logger };
}

/** 一套能跑通全链路的默认响应。 */
function happyResponses(): Partial<Record<string, unknown>> {
  return {
    'https://me.meituan.com/api/gw/v1/product/goods/queryListAndTag': roomList([
      logicRoom(354223342, 1, [goodsItem(847226645)]),
    ]),
    [MEITUAN_PRICE_INVENTORY_URL]: priceResponse([
      priceItem(847226645, { '2026-09-21': { date: '2026-09-21', salePrice: '20700', basePrice: '18009' } }),
    ]),
    [MEITUAN_ROOM_STATUS_URL]: statusResponse([
      statusItem(354223342, 1, { '2026-09-21': { date: '2026-09-21', roomStatus: 1, limitRemain: 5, usedCount: 0 } }),
    ]),
  };
}

const LIST_URL = 'https://me.meituan.com/api/gw/v1/product/goods/queryListAndTag';

describe('pickMeituanRoomCatalog', () => {
  it('挑出日历房的 roomId 与其下在售商品的 goodsId', () => {
    const catalog = pickMeituanRoomCatalog(
      roomList([logicRoom(1, 1, [goodsItem(11), goodsItem(12)])]).data,
    );

    expect(catalog.roomIds).toEqual([1]);
    expect(catalog.goodsIds).toEqual([11, 12]);
  });

  // ⚠️ 钟点房与日历房共用同一个 roomId 空间，不筛会让两行撞同一个格子键。
  // 实测 9 个逻辑房型里 3 个是钟点房，占三分之一。
  it('钟点房被源头筛掉，连同它下挂的商品', () => {
    const catalog = pickMeituanRoomCatalog(
      roomList([logicRoom(1, 1, [goodsItem(11)]), logicRoom(2, 2, [goodsItem(22)])]).data,
    );

    expect(catalog.roomIds).toEqual([1]);
    expect(catalog.goodsIds).toEqual([11]);
    expect(catalog.hourlySkipped).toBe(1);
  });

  /**
   * ⚠️ 这一层**缺失保留**，与 ④ 的展平层（缺失也丢）方向相反 —— design 决策 3.1。
   *
   * 写成 `!== 1` 会让字段缺失时筛掉**全部**房型：美团哪天改字段名，整轮落
   * `skipped: no-scannable-room-types`，与「这账号真的没日历房」在日志上分不开。
   */
  it('roomCategory 缺失时保留 —— 判不出类别多读一个无害', () => {
    const catalog = pickMeituanRoomCatalog(roomList([logicRoom(1, undefined, [goodsItem(11)])]).data);

    expect(catalog.roomIds).toEqual([1]);
    expect(catalog.goodsIds).toEqual([11]);
    expect(catalog.hourlySkipped).toBe(0);
  });

  // 回归：字段名若被渠道改掉，不能退化成「一个房型都不扫」。
  it('整批都缺 roomCategory 时不会扫不到任何房型', () => {
    const catalog = pickMeituanRoomCatalog(
      roomList([logicRoom(1, undefined, [goodsItem(11)]), logicRoom(2, undefined, [])]).data,
    );

    expect(catalog.roomIds).toEqual([1, 2]);
  });

  it('草稿 / 审核中 / 已下线的商品不进入取数范围', () => {
    const catalog = pickMeituanRoomCatalog(
      roomList([
        logicRoom(1, 1, [
          goodsItem(11),
          goodsItem(12, { auditStatus: 1 }),
          goodsItem(13, { goodsStatus: 1 }),
          goodsItem(14, { switchStatus: 1 }),
        ]),
      ]).data,
    );

    expect(catalog.goodsIds).toEqual([11]);
    expect(catalog.unsellableSkipped).toBe(3);
    // ⚠️ 房型本身仍要扫 —— 商品不可售不代表房态房量不用对账
    expect(catalog.roomIds).toEqual([1]);
  });

  it('switchStatus 未设置视为在售', () => {
    const goods = goodsItem(11);
    delete (goods as Record<string, unknown>).switchStatus;
    const catalog = pickMeituanRoomCatalog(roomList([logicRoom(1, 1, [goods])]).data);

    expect(catalog.goodsIds).toEqual([11]);
  });

  it('同一 roomId / goodsId 出现多次时去重', () => {
    const catalog = pickMeituanRoomCatalog(
      roomList([logicRoom(1, 1, [goodsItem(11)]), logicRoom(1, 1, [goodsItem(11)])]).data,
    );

    expect(catalog.roomIds).toEqual([1]);
    expect(catalog.goodsIds).toEqual([11]);
  });

  it('响应形状不对时返回空清单而不抛', () => {
    expect(pickMeituanRoomCatalog(null).roomIds).toEqual([]);
    expect(pickMeituanRoomCatalog({ realRoomRelations: 'nope' }).roomIds).toEqual([]);
  });
});

describe('flattenPriceRows', () => {
  it('按 goodsId × date 展平，取每个日期的第一条', () => {
    const rows = flattenPriceRows([
      { goodsBaseInfo: { goodsId: 11 }, goodsPriceMap: { '2026-09-21': [{ salePrice: '100' }, { salePrice: '999' }] } },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ goodsId: 11, date: '2026-09-21', salePrice: '100' });
  });

  // ⚠️ 金额是「分」的字符串，原样存 —— 转换等于在客户端复刻渠道语义。
  it('金额原样透传，不转单位也不转类型', () => {
    const rows = flattenPriceRows([
      {
        goodsBaseInfo: { goodsId: 11 },
        goodsPriceMap: { '2026-09-21': [{ salePrice: '20700', basePrice: '18009', subRatio: 1300 }] },
      },
    ]);

    expect(rows[0]).toMatchObject({ salePrice: '20700', basePrice: '18009', subRatio: 1300 });
  });

  // cell 自己也回显 date/goodsId，但权威来源是 goodsBaseInfo 与 map 的 key。
  it('goodsId 与 date 不被 cell 里的同名字段覆盖', () => {
    const rows = flattenPriceRows([
      {
        goodsBaseInfo: { goodsId: 11 },
        goodsPriceMap: { '2026-09-21': [{ goodsId: 999, date: '1999-01-01', salePrice: '1' }] },
      },
    ]);

    expect(rows[0]).toMatchObject({ goodsId: 11, date: '2026-09-21' });
  });

  it('取不到 goodsId 的项整条跳过', () => {
    expect(flattenPriceRows([{ goodsPriceMap: { '2026-09-21': [{ salePrice: '1' }] } }])).toEqual([]);
  });
});

describe('createMeituanInventoryScan', () => {
  // ⚠️ 门店清单不在这里取 —— 它随登录探测写进 credentialExtra.pois。
  // 早先还有一步 poiInfos 做「校验门店属于本账号」，会让 N 家门店重复发 N 次
  // 同样的账号级请求，已删。
  it('三步请求按序发出，产出两类带标记的行', async () => {
    const { scan, calls } = createScan(happyResponses());

    const outcome = await scan.scan(PARTITION, 2, EXTRA);

    expect(calls.map((call) => call.url)).toEqual([
      LIST_URL,
      MEITUAN_PRICE_INVENTORY_URL,
      MEITUAN_ROOM_STATUS_URL,
    ]);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.rows.map((row) => row[MEITUAN_SCAN_KIND_MARKER])).toEqual(['price', 'roomStatus']);
  });

  it('三步入参都带上 poiId 与 partnerId', async () => {
    const { scan, calls } = createScan(happyResponses());

    await scan.scan(PARTITION, 2, EXTRA);

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.body).toMatchObject({ poiId: POI_ID, partnerId: PARTNER_ID });
    }
  });

  // 窗口含今天，所以 endDate = today + windowDays - 1。
  // ⚠️ 必须与 scan-to-report 的 scanWindow 同口径，否则窗口尾部的格子永远报不出差异。
  /**
   * ⚠️ **价格请求必须传真实 `roomIds`，不能给空数组。**
   *
   * 2026-09-21 真机踩到：给空数组时美团返回非 10000，整批价格取不到
   * （`priceRows: 'failed'`，房态房量那边正常）。RPA 侧的踩点样本两者都传真实值
   * （`docs/美团/RPA-房价信息.md` §4.1）—— 当初写成空数组是没根据的假设。
   */
  it('② 价格请求同时传 goodsIds 与真实 roomIds', async () => {
    const { scan, calls } = createScan(happyResponses());

    await scan.scan(PARTITION, 2, EXTRA);

    expect(calls[1]?.body).toMatchObject({
      goodsIds: [847226645],
      roomIds: [354223342],
    });
  });

  it('窗口按 windowDays 闭区间计算', async () => {
    const { scan, calls } = createScan(happyResponses(), new Date('2026-09-21T10:00:00'));

    await scan.scan(PARTITION, 3, EXTRA);

    expect(calls[1]?.body).toMatchObject({ startDate: '2026-09-21', endDate: '2026-09-23' });
    expect(calls[2]?.body).toMatchObject({ startDate: '2026-09-21', endDate: '2026-09-23' });
  });

  it('② 只读 goodsPriceMap，不读同响应里的 goodsStatusMap', async () => {
    const { scan } = createScan(happyResponses());

    const outcome = await scan.scan(PARTITION, 2, EXTRA);

    if (outcome.kind !== 'ok') throw new Error('expected ok');
    const priceRows = outcome.rows.filter((row) => row[MEITUAN_SCAN_KIND_MARKER] === 'price');
    expect(priceRows).toHaveLength(1);
    // goodsStatusMap 里那条房态没有变成行
    expect(priceRows[0]).not.toHaveProperty('roomStatus');
  });

  // ⚠️ ④ 的响应会夹带同 roomId 的钟点房那一行，展平层挡掉它。
  it('③ 响应夹带钟点房时只留日历房', async () => {
    const responses = happyResponses();
    responses[MEITUAN_ROOM_STATUS_URL] = statusResponse([
      statusItem(354223342, 1, { '2026-09-21': { roomStatus: 1, limitRemain: 5 } }),
      statusItem(354223342, 2, { '2026-09-21': { roomStatus: 1, limitRemain: 999 } }),
    ]);
    const { scan } = createScan(responses);

    const outcome = await scan.scan(PARTITION, 2, EXTRA);

    if (outcome.kind !== 'ok') throw new Error('expected ok');
    const statusRows = outcome.rows.filter((row) => row[MEITUAN_SCAN_KIND_MARKER] === 'roomStatus');
    expect(statusRows).toHaveLength(1);
    expect(statusRows[0]).toMatchObject({ limitRemain: 5 });
  });

  // 扫描要整个窗口，不像回读那样按目标集合收窄。
  it('③ 不收窄 —— 窗口内的日期全要', async () => {
    const responses = happyResponses();
    responses[MEITUAN_ROOM_STATUS_URL] = statusResponse([
      statusItem(354223342, 1, {
        '2026-09-21': { roomStatus: 1 },
        '2026-09-22': { roomStatus: 1 },
        '2026-09-23': { roomStatus: 0 },
      }),
    ]);
    const { scan } = createScan(responses);

    const outcome = await scan.scan(PARTITION, 3, EXTRA);

    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.rows.filter((row) => row[MEITUAN_SCAN_KIND_MARKER] === 'roomStatus')).toHaveLength(3);
  });

  describe('跳过与失败', () => {
    it('缺 otaPartnerId 时跳过，且一个请求都不发', async () => {
      const { scan, calls } = createScan(happyResponses());

      const outcome = await scan.scan(PARTITION, 2, { otaHotelId: POI_ID });

      expect(outcome).toEqual({ kind: 'skipped', reason: 'missing-poi-or-partner-id' });
      expect(calls).toHaveLength(0);
    });

    it('没有可扫的日历房时落 skipped 而非 failed', async () => {
      const responses = happyResponses();
      responses[LIST_URL] = roomList([logicRoom(1, 2, [goodsItem(11)])]);
      const { scan, calls } = createScan(responses);

      const outcome = await scan.scan(PARTITION, 2, EXTRA);

      expect(outcome).toEqual({ kind: 'skipped', reason: 'no-scannable-room-types' });
      expect(calls).toHaveLength(1);
    });

    it('① 失效时整体失败，不发后续请求', async () => {
      const responses = happyResponses();
      responses[LIST_URL] = { __httpStatus: 401 };
      const { scan, calls } = createScan(responses);

      expect(await scan.scan(PARTITION, 2, EXTRA)).toEqual({
        kind: 'failed',
        reason: 'COOKIE_EXPIRED',
      });
      expect(calls).toHaveLength(1);
    });

    // ⚠️ 价格与房态是两类独立事实，一类读不到不该让另一类也丢。
    it('② 失败但 ③ 成功时仍产出房态行', async () => {
      const responses = happyResponses();
      responses[MEITUAN_PRICE_INVENTORY_URL] = { code: 606 };
      const { scan } = createScan(responses);

      const outcome = await scan.scan(PARTITION, 2, EXTRA);

      if (outcome.kind !== 'ok') throw new Error('expected ok');
      expect(outcome.rows.map((row) => row[MEITUAN_SCAN_KIND_MARKER])).toEqual(['roomStatus']);
    });

    it('③ 失败但 ② 成功时仍产出价格行', async () => {
      const responses = happyResponses();
      responses[MEITUAN_ROOM_STATUS_URL] = { code: 606 };
      const { scan } = createScan(responses);

      const outcome = await scan.scan(PARTITION, 2, EXTRA);

      if (outcome.kind !== 'ok') throw new Error('expected ok');
      expect(outcome.rows.map((row) => row[MEITUAN_SCAN_KIND_MARKER])).toEqual(['price']);
    });

    it('②③ 都失败才算本门店失败', async () => {
      const responses = happyResponses();
      responses[MEITUAN_PRICE_INVENTORY_URL] = { code: 606 };
      responses[MEITUAN_ROOM_STATUS_URL] = { code: 606 };
      const { scan } = createScan(responses);

      expect(await scan.scan(PARTITION, 2, EXTRA)).toEqual({
        kind: 'failed',
        reason: 'PARSE_ERROR',
      });
    });

    /**
     * ⚠️ 失败原因**不能塌缩** —— 403（身份认了但没权限，重登无用）与 cookie 失效
     * 的处置完全不同，都报成 `NETWORK_ERROR` 会让 GlitchTip 里两者长得一样。
     * 携程那条路是原样上传的，两个渠道要一致。
     */
    it('两侧都失败时上报真实原因，不塌缩成 NETWORK_ERROR', async () => {
      const responses = happyResponses();
      responses[MEITUAN_PRICE_INVENTORY_URL] = { __httpStatus: 403 };
      responses[MEITUAN_ROOM_STATUS_URL] = { __httpStatus: 403 };
      const { scan } = createScan(responses);

      expect(await scan.scan(PARTITION, 2, EXTRA)).toEqual({
        kind: 'failed',
        reason: 'FORBIDDEN',
      });
    });

    it('抛异常时落 UNEXPECTED 而不向上冒泡', async () => {
      const logger = createLogger();
      const scan = createMeituanInventoryScan({
        logger,
        fetcher: async () => {
          throw new Error('boom');
        },
        config: () => ({ timeoutMs: 1000 }),
      });

      expect(await scan.scan(PARTITION, 2, EXTRA)).toEqual({
        kind: 'failed',
        reason: 'UNEXPECTED',
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('空结果是合法结果，不是失败', async () => {
      const responses = happyResponses();
      responses[MEITUAN_PRICE_INVENTORY_URL] = priceResponse([]);
      responses[MEITUAN_ROOM_STATUS_URL] = statusResponse([]);
      const { scan } = createScan(responses);

      expect(await scan.scan(PARTITION, 2, EXTRA)).toEqual({ kind: 'ok', rows: [] });
    });
  });
});
