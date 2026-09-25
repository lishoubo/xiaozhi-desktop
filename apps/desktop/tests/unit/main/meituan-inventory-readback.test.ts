import { describe, expect, it, vi } from 'vitest';
import { createMeituanInventoryReadback } from '../../../src/main/channels/meituan/inventory-readback';
import type { MeituanReadbackFetcher } from '../../../src/main/channels/meituan/inventory-readback-fetcher';
import { toChannelId } from '../../../src/main/ids';
import type { OtaAmountChangeObserved } from '../../../src/shared/types/amount-change';
import type { JsonObject } from '../../../src/shared/types/json';
import type { WebContents } from 'electron';
// ⚠️ 真实响应，不自造：`docs/踩点/美团/房价房量日历-房量.md` 的回读样本原样存盘。
// 自造的 fake 可能恰好比真实类型「更干净」（如少了只在特定日期出现的 fullRoomCode），
// 把缺陷一起掩盖。
import REAL_RESPONSE from '../../fixtures/meituan/query-room-status-info.json';

const MEITUAN = toChannelId('meituan');
const INVENTORY = 'inventory-update';
const CONFIG = { timeoutMs: 30_000 };
const FAKE_WC = {} as WebContents;

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function report(changeRaw: JsonObject, endpointId = INVENTORY): OtaAmountChangeObserved {
  return {
    source: MEITUAN,
    changeType: 'roomStatus',
    endpointId,
    endpointUrl: 'https://me.meituan.com/api/gw/v1/product/goods/inventory/update',
    otaHotelId: '',
    changeRaw,
  };
}

/** 一次改动的写请求体。`roomIds` 与 `ranges` 决定回读目标。 */
function change(
  roomIds: number[],
  ranges: { startDate: string; endDate: string }[],
  effectWeek: number[] = [1, 2, 3, 4, 5, 6, 7],
): JsonObject {
  return {
    poiId: '1834077877',
    partnerId: 4824962,
    changeType: 1,
    modifyInventoryModelList: [
      {
        modifyInventorySubjectsModel: { goodsIdList: [], dayRoomIdList: roomIds, hourRoomIdList: [] },
        unifiedOperateInvDateModel: {
          modifyDates: ranges,
          modifyParamByEffectWeeks: [
            {
              effectWeek,
              updateInventoryUnifyInvUnitParam: {
                invSwitch: -1,
                countType: 1520,
                limitChangeValue: 20,
                count: 0,
              },
            },
          ],
        },
      },
    ],
  };
}

function createReadback(fetcher: MeituanReadbackFetcher, logger = createLogger()) {
  return createMeituanInventoryReadback({
    logger,
    fetcher,
    inventoryEndpointId: INVENTORY,
    config: () => CONFIG,
  });
}

/**
 * 回读响应的成功信封。⚠️ 成功码是 10000，不是 200 也不是 0。
 *
 * 返回 `unknown` 而非 `JsonObject`：这是喂给 fetcher 的**假响应**，走的是
 * `fetcher` 的 `Promise<unknown>` 出口，不需要满足 `JsonValue` 的只读索引签名。
 */
function ok(data: unknown[]): unknown {
  return { code: 10000, error: null, traceId: 't', success: true, data };
}

function roomItem(
  roomId: number,
  roomCategory: number,
  dates: Record<string, JsonObject>,
  roomName = '测试房型',
): JsonObject {
  return {
    roomBaseInfo: { roomId, roomName, roomCategory, containerId: 1 },
    goodsList: null,
    roomStatusMap: dates,
    goodsInfo: null,
    sortWeight: null,
  };
}

function cell(date: string, extra: JsonObject = {}): JsonObject {
  return {
    date,
    containerId: 1,
    shareType: 1,
    roomStatus: 1,
    limitType: 1,
    remainCount: 1,
    limitRemain: 5,
    usedCount: 0,
    invSwitch: 1,
    ...extra,
  };
}

describe('createMeituanInventoryReadback', () => {
  describe('触发边界', () => {
    it('非房量端点 → skipped，且不发请求', async () => {
      const fetcher = vi.fn();
      const outcome = await createReadback(fetcher).readback(
        report(change([1], [{ startDate: '2026-09-18', endDate: '2026-09-18' }]), 'price-update'),
        FAKE_WC,
      );
      expect(outcome).toEqual({ kind: 'skipped', reason: 'not-a-room-inventory-endpoint' });
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('取不到目标 → skipped，且不发请求（不退化为回读整店）', async () => {
      const fetcher = vi.fn();
      const outcome = await createReadback(fetcher).readback(
        report({ poiId: '1', partnerId: 2, modifyInventoryModelList: [] }),
        FAKE_WC,
      );
      expect(outcome).toEqual({ kind: 'skipped', reason: 'no-targets' });
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe('请求体', () => {
    it('取自触发报文的 poiId / partnerId，日期按 min~max', async () => {
      const fetcher = vi.fn().mockResolvedValue(ok([]));
      await createReadback(fetcher).readback(
        report(change([493882496, 493879575], [{ startDate: '2026-09-18', endDate: '2026-09-21' }])),
        FAKE_WC,
      );

      expect(fetcher).toHaveBeenCalledTimes(1);
      const [, url, body, timeout] = fetcher.mock.calls[0];
      expect(url).toBe('https://me.meituan.com/api/gw/v1/product/goods/queryRoomStatusInfo');
      expect(body).toEqual({
        roomIds: [493879575, 493882496],
        startDate: '2026-09-18',
        endDate: '2026-09-21',
        poiId: '1834077877',
        partnerId: 4824962,
      });
      expect(timeout).toBe(30_000);
    });
  });

  describe('⚠️ roomCategory 过滤 —— 同一 roomId 会返回日租 + 钟点两条', () => {
    it('真实响应：493879575 有 cat1/cat2 两条，只留 cat1', async () => {
      const fetcher = vi.fn().mockResolvedValue(REAL_RESPONSE);
      const outcome = await createReadback(fetcher).readback(
        report(change([493879575], [{ startDate: '2026-09-18', endDate: '2026-09-21' }])),
        FAKE_WC,
      );

      expect(outcome.kind).toBe('ok');
      const cells = (outcome as { report: OtaAmountChangeObserved }).report.changeRaw
        .cells as JsonObject[];
      expect(cells).toHaveLength(4); // 4 天，每天一条（不是 8 条）
      expect(cells.every((c) => c.roomCategory === 1)).toBe(true);
      // cat2 那条是 limitType:2 / limitRemain:999，绝不该出现
      expect(cells.some((c) => c.limitRemain === 999)).toBe(false);
    });

    it('roomCategory 缺失 → 丢弃该行（宁可漏读也不混入钟点房）', async () => {
      // 构造时就不给 roomCategory（而非 delete —— JsonObject 的索引签名是只读的）
      const item = {
        roomBaseInfo: { roomId: 1, roomName: '测试房型', containerId: 1 },
        roomStatusMap: { '2026-09-18': cell('2026-09-18') },
      };
      const fetcher = vi.fn().mockResolvedValue(ok([item]));

      const outcome = await createReadback(fetcher).readback(
        report(change([1], [{ startDate: '2026-09-18', endDate: '2026-09-18' }])),
        FAKE_WC,
      );
      expect(outcome.kind).toBe('ok');
      expect((outcome as { report: OtaAmountChangeObserved }).report.changeRaw.cells).toEqual([]);
    });
  });

  describe('⚠️ 按目标日期集合过滤 —— 区间比目标大时不得多报', () => {
    it('只勾周五六时，请求覆盖 7 天而 cells 只剩 2 天', async () => {
      // 2026-09-14(周一) ~ 2026-09-20(周日)，只要周五六
      const dates: Record<string, JsonObject> = {};
      for (const d of ['14', '15', '16', '17', '18', '19', '20']) {
        dates[`2026-09-${d}`] = cell(`2026-09-${d}`);
      }
      const fetcher = vi.fn().mockResolvedValue(ok([roomItem(1, 1, dates)]));

      const outcome = await createReadback(fetcher).readback(
        report(change([1], [{ startDate: '2026-09-14', endDate: '2026-09-20' }], [5, 6])),
        FAKE_WC,
      );

      // 请求按 min~max 发，覆盖整周
      expect(fetcher.mock.calls[0][2]).toMatchObject({
        startDate: '2026-09-18',
        endDate: '2026-09-19',
      });
      const cells = (outcome as { report: OtaAmountChangeObserved }).report.changeRaw
        .cells as JsonObject[];
      expect(cells.map((c) => c.date)).toEqual(['2026-09-18', '2026-09-19']);
    });

    it('响应含目标外的日期 → 丢弃', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        ok([
          roomItem(1, 1, {
            '2026-09-18': cell('2026-09-18'),
            '2026-09-19': cell('2026-09-19'), // 目标外
          }),
        ]),
      );
      const outcome = await createReadback(fetcher).readback(
        report(change([1], [{ startDate: '2026-09-18', endDate: '2026-09-18' }])),
        FAKE_WC,
      );
      const cells = (outcome as { report: OtaAmountChangeObserved }).report.changeRaw
        .cells as JsonObject[];
      expect(cells.map((c) => c.date)).toEqual(['2026-09-18']);
    });

    it('响应含未请求的房型 → 丢弃', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        ok([
          roomItem(1, 1, { '2026-09-18': cell('2026-09-18') }),
          roomItem(999, 1, { '2026-09-18': cell('2026-09-18') }),
        ]),
      );
      const outcome = await createReadback(fetcher).readback(
        report(change([1], [{ startDate: '2026-09-18', endDate: '2026-09-18' }])),
        FAKE_WC,
      );
      const cells = (outcome as { report: OtaAmountChangeObserved }).report.changeRaw
        .cells as JsonObject[];
      expect(cells).toHaveLength(1);
      expect(cells[0].roomId).toBe(1);
    });
  });

  describe('展平 roomStatusMap', () => {
    it('3 房型 × 4 天 → 12 个 cell，各带正确的 roomId 与 date', async () => {
      const dates = (): Record<string, JsonObject> => ({
        '2026-09-18': cell('2026-09-18'),
        '2026-09-19': cell('2026-09-19'),
        '2026-09-20': cell('2026-09-20'),
        '2026-09-21': cell('2026-09-21'),
      });
      const fetcher = vi.fn().mockResolvedValue(
        ok([roomItem(1, 1, dates()), roomItem(2, 1, dates()), roomItem(3, 1, dates())]),
      );

      const outcome = await createReadback(fetcher).readback(
        report(change([1, 2, 3], [{ startDate: '2026-09-18', endDate: '2026-09-21' }])),
        FAKE_WC,
      );
      const cells = (outcome as { report: OtaAmountChangeObserved }).report.changeRaw
        .cells as JsonObject[];
      expect(cells).toHaveLength(12);
      expect(new Set(cells.map((c) => c.roomId))).toEqual(new Set([1, 2, 3]));
      expect(cells.filter((c) => c.roomId === 2).map((c) => c.date).sort()).toEqual([
        '2026-09-18',
        '2026-09-19',
        '2026-09-20',
        '2026-09-21',
      ]);
    });

    it('整行透传 —— 房量字段一个不少，含只在个别日期出现的字段', async () => {
      const fetcher = vi.fn().mockResolvedValue(REAL_RESPONSE);
      const outcome = await createReadback(fetcher).readback(
        report(change([493882496], [{ startDate: '2026-09-18', endDate: '2026-09-21' }])),
        FAKE_WC,
      );
      const cells = (outcome as { report: OtaAmountChangeObserved }).report.changeRaw
        .cells as JsonObject[];
      const sample = cells.find((c) => c.date === '2026-09-18');
      // 四个房量相关字段都在，且 desktop 侧没有派生任何「房量」结论
      expect(sample).toMatchObject({
        roomId: 493882496,
        roomName: '云享三人间',
        roomCategory: 1,
        limitType: expect.any(Number),
        remainCount: expect.any(Number),
        limitRemain: expect.any(Number),
        usedCount: expect.any(Number),
        invSwitch: expect.any(Number),
      });
    });

    /**
     * ⚠️ `roomId` / `roomCategory` / `date` 的权威来源是 `roomBaseInfo`（或 map 的 key），
     * 不是 cell 本身。cell 里已经出现过 `containerId` 这种与 roomBaseInfo 重名的字段，
     * 美团哪天补一个 `roomId` 进 cell 并不离谱 —— 若被它覆盖，一行刚通过
     * `roomCategory === 1` 过滤的日租数据会带着 `roomCategory: 2` 上报出去，静默错报。
     */
    it('cell 内的同名字段不得覆盖 roomBaseInfo 的权威值', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        ok([
          roomItem(1, 1, {
            '2026-09-18': cell('2026-09-18', { roomId: 777, roomCategory: 2, date: '2099-01-01' }),
          }),
        ]),
      );
      const outcome = await createReadback(fetcher).readback(
        report(change([1], [{ startDate: '2026-09-18', endDate: '2026-09-18' }])),
        FAKE_WC,
      );
      const cells = (outcome as { report: OtaAmountChangeObserved }).report.changeRaw
        .cells as JsonObject[];
      expect(cells[0]).toMatchObject({ roomId: 1, roomCategory: 1, date: '2026-09-18' });
    });

    it('date 以 map 的 key 为准，即使 cell 内缺该字段', async () => {
      // 构造时就不给 date（而非 delete），验证展平时以 map 的 key 为准
      const { date: _omitted, ...inner } = cell('2026-09-18');
      const fetcher = vi.fn().mockResolvedValue(ok([roomItem(1, 1, { '2026-09-18': inner })]));
      const outcome = await createReadback(fetcher).readback(
        report(change([1], [{ startDate: '2026-09-18', endDate: '2026-09-18' }])),
        FAKE_WC,
      );
      const cells = (outcome as { report: OtaAmountChangeObserved }).report.changeRaw
        .cells as JsonObject[];
      expect(cells[0].date).toBe('2026-09-18');
    });
  });

  describe('失败分类', () => {
    const run = async (raw: unknown) =>
      createReadback(vi.fn().mockResolvedValue(raw)).readback(
        report(change([1], [{ startDate: '2026-09-18', endDate: '2026-09-18' }])),
        FAKE_WC,
      );

    it('401 → COOKIE_EXPIRED', async () => {
      expect(await run({ __httpStatus: 401 })).toEqual({
        kind: 'failed',
        reason: 'COOKIE_EXPIRED',
      });
    });

    // ⚠️ 403 ≠ 401：身份认了但没权限，重登解决不了
    it('403 → FORBIDDEN，不得归成 COOKIE_EXPIRED', async () => {
      expect(await run({ __httpStatus: 403 })).toEqual({ kind: 'failed', reason: 'FORBIDDEN' });
    });

    it('null（网络/超时）→ NETWORK_ERROR', async () => {
      expect(await run(null)).toEqual({ kind: 'failed', reason: 'NETWORK_ERROR' });
    });

    // 两次真机样本（2026-09-21、09-25），均与账号发现拿不到身份互证
    it('业务码 606 → COOKIE_EXPIRED', async () => {
      expect(await run({ code: 606 })).toEqual({ kind: 'failed', reason: 'COOKIE_EXPIRED' });
    });

    // 其余码不猜 —— 没有样本
    it('其余业务码非 10000 → PARSE_ERROR', async () => {
      expect(await run({ code: 401, data: [] })).toEqual({ kind: 'failed', reason: 'PARSE_ERROR' });
      expect(await run({ code: 200, data: [] })).toEqual({ kind: 'failed', reason: 'PARSE_ERROR' });
    });

    it('非 JSON 原文（可能是 HTML）→ PARSE_ERROR', async () => {
      expect(await run('<html>login</html>')).toEqual({
        kind: 'failed',
        reason: 'PARSE_ERROR',
      });
    });

    it('data 不是数组 → PARSE_ERROR', async () => {
      expect(await run({ code: 10000, data: null })).toEqual({
        kind: 'failed',
        reason: 'PARSE_ERROR',
      });
    });

    it('fetcher 抛异常 → UNEXPECTED，不向上冒泡', async () => {
      const readback = createReadback(vi.fn().mockRejectedValue(new Error('boom')));
      const outcome = await readback.readback(
        report(change([1], [{ startDate: '2026-09-18', endDate: '2026-09-18' }])),
        FAKE_WC,
      );
      expect(outcome).toEqual({ kind: 'failed', reason: 'UNEXPECTED' });
    });
  });

  describe('空结果是合法的', () => {
    it('data 为空数组 → ok 且 cells 为空（不是 failed）', async () => {
      const outcome = await createReadback(vi.fn().mockResolvedValue(ok([]))).readback(
        report(change([1], [{ startDate: '2026-09-18', endDate: '2026-09-18' }])),
        FAKE_WC,
      );
      expect(outcome.kind).toBe('ok');
      expect((outcome as { report: OtaAmountChangeObserved }).report.changeRaw.cells).toEqual([]);
    });
  });

  describe('上报体', () => {
    it('端点用回读端点，不是触发它的写端点', async () => {
      const outcome = await createReadback(vi.fn().mockResolvedValue(ok([]))).readback(
        report(change([1], [{ startDate: '2026-09-18', endDate: '2026-09-18' }])),
        FAKE_WC,
      );
      const r = (outcome as { report: OtaAmountChangeObserved }).report;
      expect(r.changeType).toBe('inventoryReadback');
      expect(r.endpointId).toBe('queryRoomStatusInfo');
      expect(r.endpointId).not.toBe(INVENTORY);
    });

    /**
     * ⚠️ service 层的 `resolveOtaHotelId` **只对携程**做归一覆盖
     * （`if (observed.source !== 'ctrip') return observed.otaHotelId`），所以美团这条
     * 留空串就真的发空串出去 —— 2026-09-18 真机日志实证过一次。
     *
     * 后果：服务端 `AppOtaChangeLocator` 跳过按门店反查，而 cells 里只有物理房型 id。
     */
    it('otaHotelId 填写请求的 poiId，与改动上报同值（不是空串）', async () => {
      const outcome = await createReadback(vi.fn().mockResolvedValue(ok([]))).readback(
        report(change([1], [{ startDate: '2026-09-18', endDate: '2026-09-18' }])),
        FAKE_WC,
      );
      expect((outcome as { report: OtaAmountChangeObserved }).report.otaHotelId).toBe('1834077877');
    });

    it('trigger 复用改动上报的 changeRaw 同一份对象，truncated 恒 false', async () => {
      const raw = change([1], [{ startDate: '2026-09-18', endDate: '2026-09-18' }]);
      const trigger = report(raw);
      const outcome = await createReadback(vi.fn().mockResolvedValue(ok([]))).readback(
        trigger,
        FAKE_WC,
      );
      const changeRaw = (outcome as { report: OtaAmountChangeObserved }).report.changeRaw;
      expect((changeRaw.trigger as JsonObject).endpointId).toBe(INVENTORY);
      expect((changeRaw.trigger as JsonObject).rawRequest).toBe(raw);
      // 美团没有「应用到所有日期」，回读范围总是精确的
      expect(changeRaw.truncated).toBe(false);
    });
  });
});
