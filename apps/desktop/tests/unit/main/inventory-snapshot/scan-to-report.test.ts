import { describe, expect, it, vi } from 'vitest';
import { createScanResultHandler } from '../../../../src/main/inventory-snapshot/scan-to-report';
import { mapCtripReadRows } from '../../../../src/main/inventory-snapshot/ctrip-cells';
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
  const handle = createScanResultHandler({
    mappers: new Map([['ctrip', mapCtripReadRows]]),
    reportBuilders: new Map([
      [
        'ctrip',
        (otaHotelId, cells) =>
          buildCtripScanReport(toChannelId('ctrip'), otaHotelId, cells, 'probed-at'),
      ],
    ]),
    readBaseline: () => baseline,
    enqueue: (cells) => void enqueued.push([...cells]),
    report: (observed, partitionName) => void reported.push({ observed, partitionName }),
    logger,
    now: () => 1700,
  });
  return { handle, enqueued, reported, logger };
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
