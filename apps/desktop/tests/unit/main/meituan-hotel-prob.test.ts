import { describe, expect, it, vi } from 'vitest';
import { meituanHotelProbe } from '../../../src/main/channels/meituan/hotel-prob';

describe('meituanHotelProbe', () => {
  describe('isProbeableUrl', () => {
    it('接受可信美团域名', () => {
      expect(meituanHotelProbe.isProbeableUrl('https://me.meituan.com/ebooking/index.html')).toBe(
        true,
      );
    });

    it('拒绝不可信域名', () => {
      expect(
        meituanHotelProbe.isProbeableUrl('https://me.meituan.com.evil.example/ebooking/index.html'),
      ).toBe(false);
    });
  });

  describe('probe', () => {
    it('读取门店列表并返回酒店', async () => {
      const executeJavaScript = vi.fn().mockResolvedValueOnce({
        code: 10000,
        data: {
          twoLevelList: [{ poiList: [{ poiId: 'hotel-1', poiName: '美团酒店一' }] }],
        },
      });
      const webContents = { executeJavaScript };

      await expect(meituanHotelProbe.probe({} as never, webContents as never)).resolves.toEqual({
        kind: 'found',
        hotels: [
          {
            otaHotelId: 'hotel-1',
            otaHotelName: '美团酒店一',
            bindExtra: null,
          },
        ],
      });
      expect(executeJavaScript).toHaveBeenCalledTimes(1);
    });

    it('门店列表为空时返回 none', async () => {
      const executeJavaScript = vi.fn().mockResolvedValueOnce({
        code: 10000,
        data: { twoLevelList: [] },
      });
      const webContents = { executeJavaScript };

      await expect(meituanHotelProbe.probe({} as never, webContents as never)).resolves.toEqual({
        kind: 'none',
      });
    });
  });
});
