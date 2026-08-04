import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const views: MockWebContentsView[] = [];

  class MockWebContentsView {
    readonly webContents = {
      close: vi.fn(),
      executeJavaScript: vi.fn(),
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(async () => {}),
      getURL: vi.fn(() => 'https://life.douyin.com/p/home?groupid=1813179858562059'),
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

import { DouyinDiscoveryProbe } from '../../../src/main/account-discovery/douyin-discovery';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const ACCOUNT_DETAIL_RESPONSE = { data: { root_life_account_id: '7324560848234481702' } };
const DSL_RESPONSE = {
  status_code: 0,
  dsl: { poiId: '7245504927202543672', poiName: '包头璞禾咖啡酒店' },
};

beforeEach(() => {
  electron.views.length = 0;
});

describe('DouyinDiscoveryProbe', () => {
  it('两步接口都成功时返回 single', async () => {
    const logger = createLogger();
    const sessionForPartition = vi.fn(() => ({ partition: 'stub' }) as never);
    const probe = new DouyinDiscoveryProbe(sessionForPartition, logger);

    const discoverPromise = probe.discover('persist:xiaozhi:prod:douyin:aaa');
    const view = electron.views[0];
    view.webContents.executeJavaScript
      .mockResolvedValueOnce(ACCOUNT_DETAIL_RESPONSE)
      .mockResolvedValueOnce(DSL_RESPONSE);

    const outcome = await discoverPromise;

    expect(sessionForPartition).toHaveBeenCalledWith('persist:xiaozhi:prod:douyin:aaa');
    expect(outcome).toEqual({
      kind: 'single',
      hotel: { otaHotelId: '7245504927202543672', displayName: '包头璞禾咖啡酒店' },
    });
    expect(view.webContents.close).toHaveBeenCalledOnce();
  });

  it('落地 URL 没有 groupid 时直接返回 none，不发起任何接口请求', async () => {
    const probe = new DouyinDiscoveryProbe(() => ({}) as never, createLogger());

    const discoverPromise = probe.discover('persist:xiaozhi:prod:douyin:bbb');
    electron.views[0].webContents.getURL.mockReturnValue('https://life.douyin.com/p/home');

    expect(await discoverPromise).toEqual({ kind: 'none' });
    expect(electron.views[0].webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it('getAccountDetail 所有模板都未解析出 root_life_account_id 时返回 none', async () => {
    const probe = new DouyinDiscoveryProbe(() => ({}) as never, createLogger());

    const discoverPromise = probe.discover('persist:xiaozhi:prod:douyin:ccc');
    electron.views[0].webContents.executeJavaScript.mockResolvedValue(null);

    expect(await discoverPromise).toEqual({ kind: 'none' });
  });

  it('dsl/get 未解析出门店时返回 none', async () => {
    const probe = new DouyinDiscoveryProbe(() => ({}) as never, createLogger());

    const discoverPromise = probe.discover('persist:xiaozhi:prod:douyin:ddd');
    const view = electron.views[0];
    view.webContents.executeJavaScript
      .mockResolvedValueOnce(ACCOUNT_DETAIL_RESPONSE)
      .mockResolvedValue({ status_code: 0, dsl: {} });

    expect(await discoverPromise).toEqual({ kind: 'none' });
  });

  it('页面加载或脚本执行异常时返回 none 并记录日志，不抛出', async () => {
    const logger = createLogger();
    const probe = new DouyinDiscoveryProbe(() => ({}) as never, logger);

    const discoverPromise = probe.discover('persist:xiaozhi:prod:douyin:eee');
    electron.views[0].webContents.executeJavaScript.mockRejectedValue(new Error('boom'));

    expect(await discoverPromise).toEqual({ kind: 'none' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('探测完成后无论成功失败都会关闭 WebContentsView', async () => {
    const probe = new DouyinDiscoveryProbe(() => ({}) as never, createLogger());

    const discoverPromise = probe.discover('persist:xiaozhi:prod:douyin:fff');
    const view = electron.views[0];
    view.webContents.executeJavaScript.mockRejectedValue(new Error('boom'));
    await discoverPromise;

    expect(view.webContents.close).toHaveBeenCalledOnce();
  });
});
