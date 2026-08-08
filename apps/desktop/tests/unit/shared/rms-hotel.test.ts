import { describe, expect, it } from 'vitest';
import { createRmsHotel, InvalidRmsHotelError } from '../../../src/shared/types/rms-hotel';

function input(overrides: Partial<{ id: number; name: string; status: number }> = {}) {
  return {
    id: 1,
    name: '示例酒店',
    status: 1,
    ...overrides,
  };
}

describe('createRmsHotel', () => {
  it('创建一个最小酒店投影', () => {
    const hotel = createRmsHotel(input());
    expect(hotel).toEqual({ id: 1, name: '示例酒店', status: 1 });
  });

  it('拒绝非正整数 id', () => {
    expect(() => createRmsHotel(input({ id: 0 }))).toThrow(InvalidRmsHotelError);
  });

  it('拒绝空白 name', () => {
    expect(() => createRmsHotel(input({ name: '  ' }))).toThrow(InvalidRmsHotelError);
  });
});
