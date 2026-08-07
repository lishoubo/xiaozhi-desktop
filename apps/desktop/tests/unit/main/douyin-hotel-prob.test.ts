import { describe, expect, it, vi } from 'vitest';
import { createDouyinHotelProbe } from '../../../src/main/features/ota-hotel-prob/ota/douyin/hotel-prob';

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('createDouyinHotelProbe', () => {
  describe('isProbeableUrl', () => {
    it('接受携带 groupid 的受信任来客首页 URL', () => {
      const probe = createDouyinHotelProbe(logger());
      expect(
        probe.isProbeableUrl('https://life.douyin.com/p/home?groupid=1813179858562059'),
      ).toBe(true);
    });

    it('拒绝不受信任域名', () => {
      const probe = createDouyinHotelProbe(logger());
      expect(
        probe.isProbeableUrl(
          'https://life.douyin.com.evil.example/p/home?groupid=1813179858562059',
        ),
      ).toBe(false);
    });

    it('拒绝非首页路径', () => {
      const probe = createDouyinHotelProbe(logger());
      expect(
        probe.isProbeableUrl('https://life.douyin.com/p/other?groupid=1813179858562059'),
      ).toBe(false);
    });

    it('拒绝缺少 groupid 的首页 URL', () => {
      const probe = createDouyinHotelProbe(logger());
      expect(probe.isProbeableUrl('https://life.douyin.com/p/home')).toBe(false);
    });
  });

  describe('probe', () => {
    it('当前 URL 没有 groupid 时直接返回 none，不发起 CDP 抓包', async () => {
      const probe = createDouyinHotelProbe(logger());
      const webContents = {
        getURL: vi.fn(() => 'https://life.douyin.com/p/home'),
      };

      await expect(probe.probe({} as never, webContents as never)).resolves.toEqual({
        kind: 'none',
      });
    });
  });
});
