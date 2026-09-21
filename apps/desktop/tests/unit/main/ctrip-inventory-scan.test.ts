import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCtripInventoryScan,
  CTRIP_SCAN_KIND_MARKER,
  type CtripScanFetcher,
} from '../../../src/main/channels/ctrip/inventory-scan';
import { CTRIP_SNAPSHOT_KIND_MARKER } from '../../../src/main/inventory-snapshot/ctrip-cells';
import type { JsonObject } from '../../../src/shared/types/json';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const PARTITION = 'persist:xiaozhi:dev:ctrip:abc';

/** 房型清单响应。`roomInfos` 是售卖房型层 —— 只读这层。 */
function productList(rooms: JsonObject[]): JsonObject {
  return { code: 200, data: [{ hotelID: 0, roomInfos: rooms }] };
}

function room(roomTypeID: number, extra: JsonObject = {}): JsonObject {
  return {
    hotelID: 122247738,
    roomTypeID,
    roomNameDesc: `房型${roomTypeID}`,
    payType: 'PP',
    roomClass: 1,
    rateCodeID: 9001,
    ...extra,
  };
}

function inventory(statusRows: JsonObject[], priceRows: JsonObject[] = []): JsonObject {
  return {
    code: 200,
    data: {
      roomStatusResult: statusRows,
      roomPriceResult: { roomPriceInfo: priceRows },
    },
  };
}

function fetcherOf(...responses: unknown[]) {
  const calls: { partitionName: string; url: string; body: JsonObject | null }[] = [];
  const fetcher: CtripScanFetcher = async (partitionName, url, body) => {
    calls.push({ partitionName, url, body });
    return responses[calls.length - 1];
  };
  return { fetcher, calls };
}

function create(fetcher: CtripScanFetcher, logger = createLogger()) {
  return {
    scan: createCtripInventoryScan({
      logger,
      fetcher,
      config: () => ({ timeoutMs: 30_000 }),
      now: () => new Date('2026-10-20T08:00:00'),
    }),
    logger,
  };
}

let defaultFetcher: ReturnType<typeof fetcherOf>;

beforeEach(() => {
  defaultFetcher = fetcherOf(
    productList([room(1), room(2)]),
    inventory(
      [{ roomTypeID: 1, effectDate: '2026-10-20', roomStatus: 'G' }],
      [{ roomTypeID: 1, effectDate: '2026-10-20', price: 328 }],
    ),
  );
});

describe('分流标记与映射侧一致', () => {
  // ⚠️ 两边各写一份字面量（eslint 禁止 channels/ 依赖 inventory-snapshot/），
  // 不一致时映射侧会把所有行当成房态，价格格子静默消失、日志无异常。
  it('CTRIP_SCAN_KIND_MARKER 与 CTRIP_SNAPSHOT_KIND_MARKER 逐字符相同', () => {
    expect(CTRIP_SCAN_KIND_MARKER).toBe(CTRIP_SNAPSHOT_KIND_MARKER);
  });
});

describe('两步请求', () => {
  it('第一步 body 为空对象 —— 门店上下文完全由 cookie 决定', async () => {
    const { scan } = create(defaultFetcher.fetcher);
    await scan.scan(PARTITION, 7, {});
    expect(defaultFetcher.calls[0]?.body).toEqual({});
    expect(defaultFetcher.calls[0]?.url).toContain('getRcProductList');
  });

  it('partitionName 原样透传给 fetcher', async () => {
    const { scan } = create(defaultFetcher.fetcher);
    await scan.scan(PARTITION, 7, {});
    expect(defaultFetcher.calls.every((c) => c.partitionName === PARTITION)).toBe(true);
  });

  it('第二步带上全部房型的六字段', async () => {
    const { scan } = create(defaultFetcher.fetcher);
    await scan.scan(PARTITION, 7, {});
    const body = defaultFetcher.calls[1]?.body as JsonObject;
    const refs = body.hotelRoomInfoDtoList as JsonObject[];
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({
      hotelID: 122247738,
      roomTypeID: 1,
      payType: 'PP',
      roomClass: 1,
      rateCodeID: 9001,
    });
  });

  // ⚠️ 缺 rateCodeID 时 roomPriceResult 为空（rms-rpa-worker 已记载）。
  it('rateCodeID 缺失时原样带 null，不替携程猜默认值', async () => {
    // 构造一个没有 rateCodeID 的房型 —— JsonObject 是 readonly，不能 delete。
    const withoutRateCode: JsonObject = {
      hotelID: 122247738,
      roomTypeID: 1,
      roomNameDesc: '房型1',
      payType: 'PP',
      roomClass: 1,
    };
    const { fetcher, calls } = fetcherOf(productList([withoutRateCode]), inventory([]));
    const { scan } = create(fetcher);
    await scan.scan(PARTITION, 7, {});
    const refs = (calls[1]?.body as JsonObject).hotelRoomInfoDtoList as JsonObject[];
    expect(refs[0]?.rateCodeID).toBeNull();
  });
});

describe('窗口计算', () => {
  it('windowDays 含今天：7 天 = 今天 + 往后 6 天', async () => {
    const { scan } = create(defaultFetcher.fetcher);
    await scan.scan(PARTITION, 7, {});
    const body = defaultFetcher.calls[1]?.body as JsonObject;
    expect(body.startDate).toBe('2026-10-20');
    expect(body.endDate).toBe('2026-10-26');
  });

  it('windowDays 为 1 时起止同日', async () => {
    const { scan } = create(defaultFetcher.fetcher);
    await scan.scan(PARTITION, 1, {});
    const body = defaultFetcher.calls[1]?.body as JsonObject;
    expect(body.startDate).toBe('2026-10-20');
    expect(body.endDate).toBe('2026-10-20');
  });
});

describe('房型过滤', () => {
  it('钟点房与预售在源头被排除', async () => {
    const { fetcher, calls } = fetcherOf(
      productList([room(1), room(2, { hourRoom: true }), room(3, { advanceSale: true })]),
      inventory([]),
    );
    const { scan } = create(fetcher);
    await scan.scan(PARTITION, 7, {});
    const refs = (calls[1]?.body as JsonObject).hotelRoomInfoDtoList as JsonObject[];
    expect(refs.map((r) => r.roomTypeID)).toEqual([1]);
  });

  // ⚠️ 判据是「明确为 true 才排除」—— 缺失或非 true 一律保留，宁可多读也不误杀。
  it('hourRoom 为 false 或缺失时保留', async () => {
    const { fetcher, calls } = fetcherOf(
      productList([room(1, { hourRoom: false }), room(2)]),
      inventory([]),
    );
    const { scan } = create(fetcher);
    await scan.scan(PARTITION, 7, {});
    const refs = (calls[1]?.body as JsonObject).hotelRoomInfoDtoList as JsonObject[];
    expect(refs).toHaveLength(2);
  });

  it('同一 roomTypeID 去重', async () => {
    const { fetcher, calls } = fetcherOf(
      productList([room(1), room(1), room(2)]),
      inventory([]),
    );
    const { scan } = create(fetcher);
    await scan.scan(PARTITION, 7, {});
    const refs = (calls[1]?.body as JsonObject).hotelRoomInfoDtoList as JsonObject[];
    expect(refs.map((r) => r.roomTypeID)).toEqual([1, 2]);
  });

  it('没有可扫房型时 skipped，不发第二个请求', async () => {
    const { fetcher, calls } = fetcherOf(productList([]));
    const { scan } = create(fetcher);
    const outcome = await scan.scan(PARTITION, 7, {});
    expect(outcome).toEqual({ kind: 'skipped', reason: 'no-scannable-room-types' });
    expect(calls).toHaveLength(1);
  });
});

describe('产出', () => {
  it('房态与价格都抽出，各带分流标记', async () => {
    const { scan } = create(defaultFetcher.fetcher);
    const outcome = await scan.scan(PARTITION, 7, {});
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.rows).toEqual([
      { roomTypeID: 1, effectDate: '2026-10-20', roomStatus: 'G', __snapshotKind: 'roomStatus' },
      { roomTypeID: 1, effectDate: '2026-10-20', price: 328, __snapshotKind: 'price' },
    ]);
  });

  // ⚠️ roomPriceResult 可能不覆盖全部格子（关房日无价）—— 房态不能因此丢。
  it('没有价格时房态照常产出', async () => {
    const { fetcher } = fetcherOf(
      productList([room(1)]),
      inventory([{ roomTypeID: 1, effectDate: '2026-10-20', roomStatus: 'N' }]),
    );
    const { scan } = create(fetcher);
    const outcome = await scan.scan(PARTITION, 7, {});
    expect(outcome.kind === 'ok' && outcome.rows).toHaveLength(1);
  });

  // ⚠️ 空结果是合法结果，不是失败 —— RPA 侧曾因把失败当成「确实为空」而全店软删。
  it('两批都为空时仍是 ok', async () => {
    const { fetcher } = fetcherOf(productList([room(1)]), inventory([]));
    const { scan } = create(fetcher);
    const outcome = await scan.scan(PARTITION, 7, {});
    expect(outcome).toEqual({ kind: 'ok', rows: [] });
  });
});

describe('失效与异常', () => {
  it('第一步登录页 → COOKIE_EXPIRED，不发第二个请求', async () => {
    const { fetcher, calls } = fetcherOf('<html>htl-ebk-login-web</html>');
    const { scan } = create(fetcher);
    const outcome = await scan.scan(PARTITION, 7, {});
    expect(outcome).toEqual({ kind: 'failed', reason: 'COOKIE_EXPIRED' });
    expect(calls).toHaveLength(1);
  });

  // ⚠️ 403 ≠ 401：没权限重登解决不了，归成 COOKIE_EXPIRED 会掩盖真因。
  it('403 判成 FORBIDDEN 而非 COOKIE_EXPIRED', async () => {
    const { fetcher } = fetcherOf({ __httpStatus: 403 });
    const { scan } = create(fetcher);
    const outcome = await scan.scan(PARTITION, 7, {});
    expect(outcome).toEqual({ kind: 'failed', reason: 'FORBIDDEN' });
  });

  it('第二步失效同样被判出来', async () => {
    const { fetcher } = fetcherOf(productList([room(1)]), { code: 401 });
    const { scan } = create(fetcher);
    const outcome = await scan.scan(PARTITION, 7, {});
    expect(outcome).toEqual({ kind: 'failed', reason: 'COOKIE_EXPIRED' });
  });

  it('fetcher 抛错被吞成 UNEXPECTED 并记 warn', async () => {
    const logger = createLogger();
    const { scan } = create(async () => {
      throw new Error('socket hang up');
    }, logger);
    const outcome = await scan.scan(PARTITION, 7, {});
    expect(outcome).toEqual({ kind: 'failed', reason: 'UNEXPECTED' });
    expect(logger.warn).toHaveBeenCalled();
  });
});
