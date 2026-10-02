import { describe, expect, it } from 'vitest';
import {
  readCtripQuantity,
  readMeituanQuantity,
} from '../../../../src/main/inventory-snapshot/quantity-reading';

describe('readCtripQuantity', () => {
  it('限量时读取可售整数，包括 0 和数字字符串', () => {
    expect(readCtripQuantity({ limitSale: 'T', freeSale: 'F', canUsedQuantity: '4' })).toEqual({
      mode: 'limited',
      available: 4,
    });
    expect(readCtripQuantity({ limitSale: 'T', canUsedQuantity: 0 })).toEqual({
      mode: 'limited',
      available: 0,
    });
  });

  it('先判不限量，忽略哨兵数字', () => {
    expect(readCtripQuantity({ limitSale: 'T', freeSale: 'T', canUsedQuantity: 0 })).toEqual({
      mode: 'unlimited',
      available: null,
    });
    expect(readCtripQuantity({ limitSale: 'F', canUsedQuantity: 999 })).toEqual({
      mode: 'unlimited',
      available: null,
    });
  });

  it('未知限量类型与非法可售值不臆造成 0', () => {
    expect(readCtripQuantity({ limitSale: true, canUsedQuantity: 5 })).toEqual({
      mode: 'unknown',
      available: null,
    });
    expect(readCtripQuantity({ limitSale: 'T' })).toEqual({
      mode: 'limited',
      available: null,
    });
    for (const canUsedQuantity of [-1, 1.5, 'abc']) {
      expect(readCtripQuantity({ limitSale: 'T', canUsedQuantity })).toEqual({
        mode: 'limited',
        available: null,
      });
    }
  });
});

describe('readMeituanQuantity', () => {
  it('限量时只取 limitRemain，不再由 usedCount 推总量', () => {
    expect(readMeituanQuantity({ limitType: 1, limitRemain: '4', usedCount: 1 })).toEqual({
      mode: 'limited',
      available: 4,
    });
    expect(readMeituanQuantity({ limitType: 1, limitRemain: 0 })).toEqual({
      mode: 'limited',
      available: 0,
    });
  });

  it('不限量时忽略哨兵，未知类型不按限量处理', () => {
    expect(readMeituanQuantity({ limitType: 2, limitRemain: 1002 })).toEqual({
      mode: 'unlimited',
      available: null,
    });
    expect(readMeituanQuantity({ limitType: 9, limitRemain: 5 })).toEqual({
      mode: 'unknown',
      available: null,
    });
  });

  it('缺失、负数和小数可售值不可读', () => {
    expect(readMeituanQuantity({ limitType: 1 })).toEqual({
      mode: 'limited',
      available: null,
    });
    for (const limitRemain of [-1, 1.5]) {
      expect(readMeituanQuantity({ limitType: 1, limitRemain })).toEqual({
        mode: 'limited',
        available: null,
      });
    }
  });
});
