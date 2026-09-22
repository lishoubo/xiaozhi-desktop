/**
 * 房量口径的单测。
 *
 * ⚠️ **样本取自本地快照库的真实行**（2026-09-22，携程 755 行 / 美团 201 行），
 * 不是自造的。自造样本容易「比真实数据更干净」，恰好绕开渠道的反直觉约定 ——
 * 而那些约定正是本模块存在的理由。
 */
import { describe, expect, it } from 'vitest';
import {
  readCtripQuantity,
  readMeituanQuantity,
} from '../../../../src/main/inventory-snapshot/quantity-reading';

describe('readCtripQuantity', () => {
  it('限量房读出总房量，hasInventory 为 true 时不算售罄', () => {
    // 真实行：limitSale=T freeSale=F total=4 canUsed=2 hasInventory=true
    expect(
      readCtripQuantity({
        limitSale: 'T',
        freeSale: 'F',
        totalQuantity: 4,
        canUsedQuantity: 2,
        hasInventory: true,
      }),
    ).toEqual({ total: 4, soldOut: false });
  });

  it('限量房 hasInventory 为 false 判为售罄', () => {
    expect(
      readCtripQuantity({
        limitSale: 'T',
        freeSale: 'F',
        totalQuantity: 4,
        canUsedQuantity: 0,
        hasInventory: false,
      }),
    ).toEqual({ total: 4, soldOut: true });
  });

  // ⭐ 本模块的立论：这类行在库里有 68 条，hasInventory 全是 false，
  // 但渠道文档明写「实际有房」。裸用 hasInventory 会把它们全判成售罄。
  it('⭐ freeSale=T 的不限量房：房量 0 且 hasInventory=false，仍不判售罄', () => {
    expect(
      readCtripQuantity({
        limitSale: 'F',
        freeSale: 'T',
        totalQuantity: 0,
        canUsedQuantity: 0,
        hasInventory: false,
      }),
    ).toEqual({ total: null, soldOut: false });
  });

  it('limitSale=F 的不限量房同样不判售罄', () => {
    expect(
      readCtripQuantity({
        limitSale: 'F',
        freeSale: 'F',
        totalQuantity: 0,
        canUsedQuantity: 0,
        hasInventory: false,
      }),
    ).toEqual({ total: null, soldOut: false });
  });

  it('限量但 totalQuantity 缺失时 total 为 null，不臆造数字', () => {
    expect(readCtripQuantity({ limitSale: 'T', hasInventory: true })).toEqual({
      total: null,
      soldOut: false,
    });
  });

  it('枚举是字符串 T/F，不认布尔（渠道原样透传，不做归一）', () => {
    // limitSale 若被写成布尔 true，说明上游做了转换 —— 按不限量处理，不误判房量。
    expect(readCtripQuantity({ limitSale: true, totalQuantity: 5 })).toEqual({
      total: null,
      soldOut: false,
    });
  });
});

describe('readMeituanQuantity', () => {
  it('限量房：总房量 = limitRemain + usedCount（配额，非物理房量）', () => {
    // 真实行：云舒双床房 limitRemain=39 usedCount=1 → 配额 40
    // ⚠️ remainCount=1 是**预留房量**，与配额无关 —— 拿它参与总量计算会算成 2。
    expect(
      readMeituanQuantity({
        limitType: 1,
        limitRemain: 39,
        remainCount: 1,
        usedCount: 1,
      }),
    ).toEqual({ total: 40, soldOut: false });
  });

  // ⭐ 「有订单不误报」所依赖的不变量：卖出一间，配额不变。
  it('⭐ 卖出一间：limitRemain −1、usedCount +1，总房量不变', () => {
    const before = readMeituanQuantity({ limitType: 1, limitRemain: 20, usedCount: 0 });
    const after = readMeituanQuantity({ limitType: 1, limitRemain: 19, usedCount: 1 });
    expect(before.total).toBe(20);
    expect(after.total).toBe(20);
  });

  it('limitRemain=0 判为售罄', () => {
    // 真实行：奢华雅致双床房 10-02，limitRemain=0 usedCount=10（真卖光）
    expect(
      readMeituanQuantity({
        limitType: 1,
        limitRemain: 0,
        remainCount: 0,
        usedCount: 10,
      }),
    ).toEqual({ total: 10, soldOut: true });
  });

  // ⭐ remainCount 是预留房量，为 0 只说明没预留，与售罄无关。
  // 库里这类行有 32 条，配额都还有剩；真售罄只有 1 条。
  it('⭐ remainCount=0（无预留）但配额有剩：不判售罄', () => {
    expect(
      readMeituanQuantity({
        limitType: 1,
        limitRemain: 22,
        remainCount: 0,
        usedCount: 0,
      }),
    ).toEqual({ total: 22, soldOut: false });
  });

  // ⚠️ 文档记的哨兵是 998/999，本地库实测到 1002 —— 哨兵不是固定几个值，
  // 所以判 limitType 而不是判具体数字。
  it('⚠️ 不限量（limitType=2）：哨兵值 1002 不当作总房量', () => {
    expect(
      readMeituanQuantity({
        limitType: 2,
        limitRemain: 1002,
        remainCount: 3,
        usedCount: 0,
      }),
    ).toEqual({ total: null, soldOut: false });
  });

  it('未见过的 limitType 按不限量处理，不拿数字比大小', () => {
    expect(readMeituanQuantity({ limitType: 9, limitRemain: 5, usedCount: 0 })).toEqual({
      total: null,
      soldOut: false,
    });
  });

  it('usedCount 缺失时算不出配额，total 为 null', () => {
    expect(readMeituanQuantity({ limitType: 1, limitRemain: 5 })).toEqual({
      total: null,
      soldOut: false,
    });
  });

  it('limitRemain 缺失时 total 为 null 且不判售罄', () => {
    expect(readMeituanQuantity({ limitType: 1, usedCount: 2 })).toEqual({
      total: null,
      soldOut: false,
    });
  });

  it('字符串数字也能读（渠道偶尔回字符串）', () => {
    expect(
      readMeituanQuantity({ limitType: '1', limitRemain: '19', usedCount: '1' }),
    ).toEqual({ total: 20, soldOut: false });
  });
});
