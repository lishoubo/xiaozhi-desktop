import { describe, expect, it } from 'vitest';
import { paginate } from '../../src/renderer/hotel-management/model';

const ITEMS = ['a', 'b', 'c', 'd', 'e'];

describe('paginate', () => {
  it('切出当前页的条目', () => {
    expect(paginate(ITEMS, 1, 2).pageItems).toEqual(['a', 'b']);
    expect(paginate(ITEMS, 2, 2).pageItems).toEqual(['c', 'd']);
  });

  /** 删到最后一页空了、或重新加载后总数变少，页码不回退就会停在空白页。 */
  it('页码越界时夹回最后一页', () => {
    const { safePage, pageItems } = paginate(ITEMS, 99, 2);

    expect(safePage).toBe(3);
    expect(pageItems).toEqual(['e']);
  });

  it('页码小于 1 时夹回第一页', () => {
    expect(paginate(ITEMS, 0, 2).safePage).toBe(1);
    expect(paginate(ITEMS, -5, 2).safePage).toBe(1);
  });

  it('空列表仍然是第 1 页共 1 页，不出现 0 页', () => {
    const { safePage, totalPages, pageItems } = paginate([], 1, 10);

    expect(safePage).toBe(1);
    expect(totalPages).toBe(1);
    expect(pageItems).toEqual([]);
  });
});
