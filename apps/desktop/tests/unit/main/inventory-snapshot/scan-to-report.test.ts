import { describe, expect, it, vi } from 'vitest';
import {
  createScanResultHandler,
  ITEM_TYPE_FIELD,
} from '../../../../src/main/inventory-snapshot/scan-to-report';
import { mapCtripReadRows } from '../../../../src/main/inventory-snapshot/ctrip-cells';
import { readCtripQuantity } from '../../../../src/main/inventory-snapshot/quantity-reading';
import { buildCtripScanReport } from '../../../../src/main/channels/ctrip/inventory-scan-payload';
import type { SnapshotCell } from '../../../../src/main/inventory-snapshot/types';
import { toChannelId } from '../../../../src/main/ids';
import type { JsonObject } from '../../../../src/shared/types/json';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const TARGET = { channel: 'ctrip', partitionName: 'persist:ctrip:a', otaHotelId: '122244992' };

function statusRow(roomTypeID: number, date: string, extra: JsonObject = {}): JsonObject {
  return {
    roomTypeID,
    effectDate: date,
    roomStatus: 'G',
    limitSale: 'T',
    totalQuantity: 5,
    canUsedQuantity: 5,
    __snapshotKind: 'roomStatus',
    ...extra,
  };
}

function create(baseline: readonly SnapshotCell[], logger = createLogger()) {
  const enqueued: SnapshotCell[][] = [];
  const reported: { observed: unknown; partitionName: string }[] = [];
  /** 记录查基线的入参 —— 区间是否按请求窗口算，只有这里看得出来。 */
  const baselineQueries: { source: string; startDate: string; endDate: string }[] = [];
  const raw = createScanResultHandler({
    mappers: new Map([['ctrip', mapCtripReadRows]]),
    reportBuilders: new Map([
      [
        'ctrip',
        (otaHotelId, cells) =>
          buildCtripScanReport(toChannelId('ctrip'), otaHotelId, cells, 'probed-at'),
      ],
    ]),
    quantityReaders: new Map([['ctrip', readCtripQuantity]]),
    newTraceId: () => 'trace-1',
    readBaseline: (source, _otaHotelId, startDate, endDate) => {
      baselineQueries.push({ source, startDate, endDate });
      return baseline;
    },
    enqueue: (cells) => void enqueued.push([...cells]),
    report: (observed, partitionName) => void reported.push({ observed, partitionName }),
    logger,
    now: () => 1700,
  });
  /** 默认 15 天窗口（与 defaults.ts 同值），个别用例可覆盖。 */
  const handle = (
    target: Parameters<typeof raw>[0],
    rows: Parameters<typeof raw>[1],
    windowDays = 15,
  ) => raw(target, rows, windowDays);
  return { handle, enqueued, reported, logger, baselineQueries };
}

/** 造一条与 mapCtripReadRows 产出同键的基线格子。 */
function baselineCell(roomTypeID: number, date: string, contentHash: string): SnapshotCell {
  return {
    source: 'ctrip',
    otaHotelId: '122244992',
    otaPhysicalRoomId: '',
    otaSaleRoomId: String(roomTypeID),
    itemType: 'roomStatus',
    itemDate: date,
    itemData: {},
    contentHash,
    observedAt: 1,
    sourceOfTruth: 'page-read',
  };
}

/**
 * 造一条**带真实 itemData** 的基线格子 —— 上报判据要比新旧房量，
 * `itemData: {}` 的基线会被判成「模式切换」而全部放行，测不出收窄效果。
 */
function baselineCellWith(roomTypeID: number, date: string, itemData: JsonObject): SnapshotCell {
  return {
    ...baselineCell(roomTypeID, date, 'OLD-HASH'),
    itemData,
  };
}

describe('上报判据接线', () => {
  // ⭐ 本次收窄要解决的核心噪音：有订单的房型每轮都在变，但不该每轮都报。
  it('⭐ 卖出一间（总房量未变、未售罄）不上报，但仍写基线', () => {
    const { handle, enqueued, reported } = create([
      baselineCellWith(1, '2026-10-20', {
        roomStatus: 'G',
        limitSale: 'T',
        freeSale: 'F',
        totalQuantity: 5,
        canUsedQuantity: 5,
        hasInventory: true,
      }),
    ]);

    handle(TARGET, [
      statusRow(1, '2026-10-20', { canUsedQuantity: 4, freeSale: 'F', hasInventory: true }),
    ]);

    expect(reported).toHaveLength(0);
    expect(enqueued[0]).toHaveLength(1);
  });

  it('⭐ 总房量变化仍上报', () => {
    const { handle, reported } = create([
      baselineCellWith(1, '2026-10-20', {
        roomStatus: 'G',
        limitSale: 'T',
        freeSale: 'F',
        totalQuantity: 5,
        canUsedQuantity: 5,
        hasInventory: true,
      }),
    ]);

    handle(TARGET, [
      statusRow(1, '2026-10-20', { totalQuantity: 8, freeSale: 'F', hasInventory: true }),
    ]);

    expect(reported).toHaveLength(1);
  });

  it('⭐ 房态变化仍上报', () => {
    const { handle, reported } = create([
      baselineCellWith(1, '2026-10-20', {
        roomStatus: 'G',
        limitSale: 'T',
        freeSale: 'F',
        totalQuantity: 5,
        canUsedQuantity: 5,
        hasInventory: true,
      }),
    ]);

    handle(TARGET, [
      statusRow(1, '2026-10-20', { roomStatus: 'N', freeSale: 'F', hasInventory: true }),
    ]);

    expect(reported).toHaveLength(1);
  });

  // ⚠️ changed 与 reported 的差额就是被滤掉的销售噪音，日志上要看得出来。
  it('日志同时打 changed 与 reported', () => {
    const { handle, logger } = create([
      baselineCellWith(1, '2026-10-20', {
        roomStatus: 'G',
        limitSale: 'T',
        freeSale: 'F',
        totalQuantity: 5,
        canUsedQuantity: 5,
        hasInventory: true,
      }),
    ]);

    handle(TARGET, [
      statusRow(1, '2026-10-20', { canUsedQuantity: 4, freeSale: 'F', hasInventory: true }),
    ]);

    expect(logger.info).toHaveBeenCalledWith(
      'Inventory scan compared',
      expect.objectContaining({
        traceId: 'trace-1',
        changed: { roomStatus: 1, price: 0 },
        reported: { roomStatus: 0, price: 0 },
        suppressed: 1,
      }),
    );
  });
});

describe('链路 ID', () => {
  // ⚠️ 立论：一轮扫描打出的几条日志之间，必须有一个字段能串起来 ——
  // 四个门店的扫描只隔几百毫秒，靠时间戳分不出谁是谁。
  it('traceId 随上报体一起交给 service（复用为 operationId）', () => {
    const { handle, reported } = create([baselineCell(1, '2026-10-20', 'OLD')]);
    handle(TARGET, [statusRow(1, '2026-10-20')]);

    expect((reported[0]?.observed as { traceId?: string }).traceId).toBe('trace-1');
  });

  it('比对日志带上同一个 traceId', () => {
    const { handle, logger } = create([baselineCell(1, '2026-10-20', 'OLD')]);
    handle(TARGET, [statusRow(1, '2026-10-20')]);

    expect(logger.info).toHaveBeenCalledWith(
      'Inventory scan compared',
      expect.objectContaining({ traceId: 'trace-1' }),
    );
  });
});

describe('首次扫描', () => {
  // ⚠️ 本模块最重要的一条：基线天然稀疏，把「没读过」当成「渠道新增了」会在首轮
  // 把整个窗口灌给服务端。
  it('基线为空时只写不报', () => {
    const { handle, enqueued, reported } = create([]);
    handle(TARGET, [statusRow(1, '2026-10-20'), statusRow(2, '2026-10-20')]);
    expect(enqueued[0]).toHaveLength(2);
    expect(reported).toHaveLength(0);
  });
});

describe('有基线时比对', () => {
  it('内容变了才上报', () => {
    const { handle, reported } = create([baselineCell(1, '2026-10-20', 'OLD-HASH')]);
    handle(TARGET, [statusRow(1, '2026-10-20')]);
    expect(reported).toHaveLength(1);
  });

  it('内容一致时不上报，但仍写入（刷新 observedAt）', () => {
    // 先算出映射后的真实 hash，作为基线 —— 保证「一致」是真的一致。
    const mapped = mapCtripReadRows([statusRow(1, '2026-10-20')], '122244992', 'scan', 1);
    const same = { ...baselineCell(1, '2026-10-20', mapped[0]?.contentHash ?? '') };
    const { handle, enqueued, reported } = create([same]);

    handle(TARGET, [statusRow(1, '2026-10-20')]);

    expect(reported).toHaveLength(0);
    expect(enqueued[0]).toHaveLength(1);
  });

  it('混合：变的上报，新增的只写', () => {
    const { handle, enqueued, reported } = create([baselineCell(1, '2026-10-20', 'OLD')]);
    handle(TARGET, [statusRow(1, '2026-10-20'), statusRow(9, '2026-10-20')]);

    expect(enqueued[0]).toHaveLength(2);
    expect(reported).toHaveLength(1);
    const raw = (reported[0]?.observed as { changeRaw: JsonObject }).changeRaw;
    // 只报变了的那一格，新增的不在里面。
    expect(raw.cells).toHaveLength(1);
  });
});

describe('上报体', () => {
  it('endpointId 是 inventoryScan，changeType 是 inventoryDiff', () => {
    const { handle, reported } = create([baselineCell(1, '2026-10-20', 'OLD')]);
    handle(TARGET, [statusRow(1, '2026-10-20')]);
    expect(reported[0]?.observed).toMatchObject({
      endpointId: 'inventoryScan',
      // ⚠️ 与回读的 inventoryReadback 区分：那个报现状，这个报比对出的差异。
      changeType: 'inventoryDiff',
      otaHotelId: '122244992',
    });
  });

  // ⚠️ trigger 与 truncated 刻意不带：扫描由定时器触发，没有对应的用户操作可指；
  // 扫描窗口完全可知，不存在「可能不完整」的情况。留着只会是同义反复。
  it('changeRaw 只有 probedAt 与 cells，不含 trigger/truncated', () => {
    const { handle, reported } = create([baselineCell(1, '2026-10-20', 'OLD')]);
    handle(TARGET, [statusRow(1, '2026-10-20')]);
    const raw = (reported[0]?.observed as { changeRaw: JsonObject }).changeRaw;
    expect(Object.keys(raw).sort()).toEqual(['cells', 'probedAt']);
    expect(raw.probedAt).toBe('probed-at');
  });

  it('partitionName 透传给上报服务（它据此查凭证补身份）', () => {
    const { handle, reported } = create([baselineCell(1, '2026-10-20', 'OLD')]);
    handle(TARGET, [statusRow(1, '2026-10-20')]);
    expect(reported[0]?.partitionName).toBe('persist:ctrip:a');
  });

  // ⚠️ cells 里是渠道原始行，不是我们的格子结构 —— 服务端认渠道字段。
  it('cells 是渠道原始行，不含分流标记', () => {
    const { handle, reported } = create([baselineCell(1, '2026-10-20', 'OLD')]);
    handle(TARGET, [statusRow(1, '2026-10-20')]);
    const raw = (reported[0]?.observed as { changeRaw: JsonObject }).changeRaw;
    const cells = raw.cells as JsonObject[];
    expect(cells[0]).toMatchObject({ roomTypeID: 1, roomStatus: 'G' });
    expect(cells[0]).not.toHaveProperty('__snapshotKind');
  });

  /**
   * ⚠️ 基线库里本就有 `itemType` 这一维，只发 `itemData` 等于把它丢掉，逼服务端靠
   * 字段特征猜（「有 salePrice 就是价格」）。
   *
   * 携程两类格子共用同一个 `roomTypeID`，猜错代价有限；**美团是两个 ID 空间**
   * （房态房量挂 roomId、价格挂 goodsId），猜错会拿 goodsId 去查物理房型 ——
   * 查不到，或更糟：查到一个同号的别的房型。
   */
  it('每个 cell 带上 __itemType，标明这一格是什么', () => {
    const { handle, reported } = create([baselineCell(1, '2026-10-20', 'OLD')]);
    handle(TARGET, [statusRow(1, '2026-10-20')]);
    const raw = (reported[0]?.observed as { changeRaw: JsonObject }).changeRaw;
    const cells = raw.cells as JsonObject[];
    expect(cells[0]).toHaveProperty(ITEM_TYPE_FIELD, 'roomStatus');
  });
});

describe('边界', () => {
  it('行映射不出格子时记 info，不写不报', () => {
    const { handle, enqueued, reported, logger } = create([]);
    handle(TARGET, [{ nonsense: true }]);
    expect(enqueued).toHaveLength(0);
    expect(reported).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      'Inventory scan produced no cells',
      expect.anything(),
    );
  });

  it('未注册的渠道直接跳过', () => {
    const { handle, enqueued, reported } = create([]);
    handle({ ...TARGET, channel: 'meituan' }, [statusRow(1, '2026-10-20')]);
    expect(enqueued).toHaveLength(0);
    expect(reported).toHaveLength(0);
  });
});

// ⚠️ 区间必须用**本轮请求的窗口**算，不从返回数据反推 min/max —— 反推会让查询范围随
// 渠道返回了什么而漂移；若查得比请求窄，窗口尾部的格子每轮都被当成「首次见到」只写
// 不报，差异永远报不出来。
describe('比对区间', () => {
  it('按请求窗口算，与返回数据的日期范围无关', () => {
    const { handle, baselineQueries } = create([]);
    // 只返回窗口中间的一天，区间仍应覆盖整个 15 天窗口。
    handle(TARGET, [statusRow(1, '1970-01-08')], 15);
    expect(baselineQueries).toHaveLength(1);
    expect(baselineQueries[0]).toMatchObject({
      source: 'ctrip',
      startDate: '1970-01-01',
      endDate: '1970-01-15',
    });
  });

  it('窗口天数含今天：1 天时起止同日', () => {
    const { handle, baselineQueries } = create([]);
    handle(TARGET, [statusRow(1, '1970-01-01')], 1);
    expect(baselineQueries[0]).toMatchObject({
      startDate: '1970-01-01',
      endDate: '1970-01-01',
    });
  });
});
