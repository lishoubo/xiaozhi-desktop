import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createCtripDiscovery } from '../../../src/main/ota/ctrip/discover-ctrip';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createWebContents(url: string, raw: unknown): WebContents {
  return {
    getURL: vi.fn(() => url),
    executeJavaScript: vi.fn().mockResolvedValue(raw),
    loadURL: vi.fn(),
    close: vi.fn(),
  } as unknown as WebContents;
}

describe('createCtripDiscovery', () => {
  it('从当前携程页面发现单酒店并返回 hotel-dom 临时 credential 身份', async () => {
    const webContents = createWebContents('https://ebooking.ctrip.com/hotel/12345', [
      { hotelId: '12345', hotelName: '测试酒店' },
    ]);
    const discover = createCtripDiscovery(createLogger());

    await expect(
      discover('persist:xiaozhi:prod:ctrip:aaa', webContents.getURL(), webContents),
    ).resolves.toEqual({
      kind: 'found',
      credential: {
        channelAccountId: '12345',
        credentialExtra: {
          hotelId: '12345',
          hotelName: '测试酒店',
          identitySource: 'hotel-dom',
        },
      },
      hotels: [{ otaHotelId: '12345', otaHotelName: '测试酒店', bindExtra: null }],
    });
    expect(webContents.executeJavaScript).toHaveBeenCalledOnce();
    expect(webContents.loadURL).not.toHaveBeenCalled();
    expect(webContents.close).not.toHaveBeenCalled();
  });

  it('当前页面发现多家酒店时返回 multiple 且不生成 credential 身份', async () => {
    const webContents = createWebContents('https://ebooking.ctrip.com/home/mainland', [
      { hotelId: '1', hotelName: '门店A' },
      { hotelId: '2', hotelName: '门店B' },
    ]);
    const discover = createCtripDiscovery(createLogger());

    const result = await discover(
      'persist:xiaozhi:prod:ctrip:bbb',
      webContents.getURL(),
      webContents,
    );

    expect(result).toEqual({
      kind: 'multiple',
      hotels: [
        { otaHotelId: '1', otaHotelName: '门店A', bindExtra: null },
        { otaHotelId: '2', otaHotelName: '门店B', bindExtra: null },
      ],
    });
  });

  it('当前页面不是受信任携程商家后台时拒绝执行脚本', async () => {
    const logger = createLogger();
    const webContents = createWebContents('https://ebooking.ctrip.com.evil.example/home', []);
    const discover = createCtripDiscovery(logger);

    await expect(
      discover('persist:xiaozhi:prod:ctrip:ccc', webContents.getURL(), webContents),
    ).resolves.toEqual({ kind: 'none' });
    expect(webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Ctrip discovery rejected untrusted current URL');
  });

  it('DOM 结果无效或脚本执行失败时返回 none', async () => {
    const logger = createLogger();
    const invalidWebContents = createWebContents('https://ebooking.ctrip.com/home/mainland', [
      { hotelId: '', hotelName: '无效酒店' },
    ]);
    const failedWebContents = createWebContents('https://ebooking.ctrip.com/home/mainland', []);
    vi.mocked(failedWebContents.executeJavaScript).mockRejectedValue(new Error('boom'));
    const discover = createCtripDiscovery(logger);

    await expect(
      discover('persist:xiaozhi:prod:ctrip:ddd', invalidWebContents.getURL(), invalidWebContents),
    ).resolves.toEqual({ kind: 'none' });
    await expect(
      discover('persist:xiaozhi:prod:ctrip:eee', failedWebContents.getURL(), failedWebContents),
    ).resolves.toEqual({ kind: 'none' });
  });
});
