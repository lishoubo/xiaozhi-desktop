import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const views: MockWebContentsView[] = [];

  class MockWebContentsView {
    readonly webContents = {
      close: vi.fn(),
      executeJavaScript: vi.fn(),
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(async () => {}),
    };

    constructor(readonly options: { webPreferences: { session: unknown } }) {
      views.push(this);
    }
  }

  return { MockWebContentsView, views };
});

vi.mock('electron', () => ({
  WebContentsView: electron.MockWebContentsView,
}));

import { CtripDiscoveryProbe } from '../../../src/main/account-discovery/ctrip-discovery';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  electron.views.splice(0);
});

describe('CtripDiscoveryProbe', () => {
  it('页面解析出一家门店时返回 single', async () => {
    const logger = createLogger();
    const sessionForPartition = vi.fn(() => ({ partition: 'stub' }) as never);
    const probe = new CtripDiscoveryProbe(sessionForPartition, logger);

    electron.views.length = 0;
    const discoverPromise = probe.discover('persist:xiaozhi:prod:ctrip:aaa', 'https://ebooking.ctrip.com/hotel/12345', {} as never);
    const view = electron.views[0];
    view.webContents.executeJavaScript.mockResolvedValue([
      { hotelId: '12345', hotelName: '测试酒店' },
    ]);

    const outcome = await discoverPromise;

    expect(sessionForPartition).toHaveBeenCalledWith('persist:xiaozhi:prod:ctrip:aaa');
    expect(outcome).toEqual({
      kind: 'single',
      hotel: { otaHotelId: '12345', otaHotelName: '测试酒店' },
    });
    expect(view.webContents.close).toHaveBeenCalledOnce();
  });

  it('页面解析出多家门店时返回 multiple', async () => {
    const probe = new CtripDiscoveryProbe(() => ({}) as never, createLogger());

    const discoverPromise = probe.discover('persist:xiaozhi:prod:ctrip:bbb', 'https://ebooking.ctrip.com/home/mainland', {} as never);
    electron.views[0].webContents.executeJavaScript.mockResolvedValue([
      { hotelId: '1', hotelName: '门店A' },
      { hotelId: '2', hotelName: '门店B' },
    ]);

    const outcome = await discoverPromise;
    expect(outcome.kind).toBe('multiple');
    if (outcome.kind === 'multiple') expect(outcome.hotels).toHaveLength(2);
  });

  it('页面没有解析出任何门店（如 cookie 已过期）时返回 none', async () => {
    const probe = new CtripDiscoveryProbe(() => ({}) as never, createLogger());

    const discoverPromise = probe.discover('persist:xiaozhi:prod:ctrip:ccc', 'https://ebooking.ctrip.com/home/mainland', {} as never);
    electron.views[0].webContents.executeJavaScript.mockResolvedValue([]);

    expect(await discoverPromise).toEqual({ kind: 'none' });
  });

  it('页面加载或脚本执行异常时返回 none 并记录日志，不抛出', async () => {
    const logger = createLogger();
    const probe = new CtripDiscoveryProbe(() => ({}) as never, logger);

    const discoverPromise = probe.discover('persist:xiaozhi:prod:ctrip:ddd', 'https://ebooking.ctrip.com/home/mainland', {} as never);
    electron.views[0].webContents.executeJavaScript.mockRejectedValue(new Error('boom'));

    expect(await discoverPromise).toEqual({ kind: 'none' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('探测完成后无论成功失败都会关闭 WebContentsView', async () => {
    const probe = new CtripDiscoveryProbe(() => ({}) as never, createLogger());

    const discoverPromise = probe.discover('persist:xiaozhi:prod:ctrip:eee', 'https://ebooking.ctrip.com/home/mainland', {} as never);
    const view = electron.views[0];
    view.webContents.executeJavaScript.mockRejectedValue(new Error('boom'));
    await discoverPromise;

    expect(view.webContents.close).toHaveBeenCalledOnce();
  });
});
