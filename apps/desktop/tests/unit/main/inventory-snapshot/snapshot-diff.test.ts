import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '../../../../src/main/inventory-snapshot/snapshot-diff';
import type { SnapshotCell } from '../../../../src/main/inventory-snapshot/types';

function cell(overrides: Partial<SnapshotCell> = {}): SnapshotCell {
  return {
    source: 'ctrip',
    otaHotelId: '122247738',
    otaPhysicalRoomId: '',
    otaSaleRoomId: '1569052069',
    itemType: 'roomStatus',
    itemDate: '2026-10-20',
    itemData: { roomStatus: 'G' },
    contentHash: 'hash-1',
    observedAt: 1,
    sourceOfTruth: 'scan',
    ...overrides,
  };
}

describe('diffSnapshots', () => {
  it('contentHash 不同判为 changed', () => {
    const diff = diffSnapshots([cell({ contentHash: 'new' })], [cell({ contentHash: 'old' })]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
  });

  it('contentHash 相同不产出任何结果', () => {
    const diff = diffSnapshots([cell()], [cell()]);
    expect(diff.changed).toHaveLength(0);
    expect(diff.added).toHaveLength(0);
  });

  // ⚠️ 这条是本模块的立论：基线稀疏时不能把「没读过」当成「渠道新增了」。
  it('基线里没有的格子判为 added，不混进 changed', () => {
    const diff = diffSnapshots([cell()], []);
    expect(diff.changed).toHaveLength(0);
    expect(diff.added).toHaveLength(1);
  });

  it('observedAt 与 sourceOfTruth 不参与比对', () => {
    const diff = diffSnapshots(
      [cell({ observedAt: 999, sourceOfTruth: 'scan' })],
      [cell({ observedAt: 1, sourceOfTruth: 'readback' })],
    );
    expect(diff.changed).toHaveLength(0);
  });

  it('基线里有、最新数据里没有的格子不产出结果（不做删除判定）', () => {
    const diff = diffSnapshots([], [cell()]);
    expect(diff.changed).toHaveLength(0);
    expect(diff.added).toHaveLength(0);
  });

  it('按完整的格子键匹配：房型或日期不同即视为不同格', () => {
    const diff = diffSnapshots(
      [cell({ itemDate: '2026-10-21' })],
      [cell({ itemDate: '2026-10-20' })],
    );
    expect(diff.added).toHaveLength(1);
    expect(diff.changed).toHaveLength(0);
  });

  it('item_type 不同视为不同格', () => {
    const diff = diffSnapshots(
      [cell({ itemType: 'price', contentHash: 'p' })],
      [cell({ itemType: 'roomStatus', contentHash: 'r' })],
    );
    expect(diff.added).toHaveLength(1);
    expect(diff.changed).toHaveLength(0);
  });

  it('混合场景：变更、新增、未变各归各位', () => {
    const baseline = [
      cell({ itemDate: '2026-10-20', contentHash: 'a' }),
      cell({ itemDate: '2026-10-21', contentHash: 'b' }),
    ];
    const latest = [
      cell({ itemDate: '2026-10-20', contentHash: 'a' }), // 未变
      cell({ itemDate: '2026-10-21', contentHash: 'b2' }), // 变了
      cell({ itemDate: '2026-10-22', contentHash: 'c' }), // 新增
    ];
    const diff = diffSnapshots(latest, baseline);
    expect(diff.changed.map((c) => c.itemDate)).toEqual(['2026-10-21']);
    expect(diff.added.map((c) => c.itemDate)).toEqual(['2026-10-22']);
  });
});
