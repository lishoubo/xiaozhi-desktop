import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createCtripDiscovery } from '../../../src/main/channels/ctrip/discovery';

/**
 * 样本取自真机踩点（`docs/踩点/携程/账号身份.md`）：账号 `huid` 与酒店
 * `masterHotelId` 是两个独立标识，改口径前把后者当成了账号身份。
 */
const HE_APP_INFO_SAMPLE = {
  huid: 12324831,
  userName: '银际青山店',
  login: '银际酒店青山王府井店',
  userType: 'HOTEL',
  masterHotelId: 85068938,
  hotelName: '银际酒店(包头市青山王府井文化路店)',
  identitySource: 'he-app-info',
};

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
  it('用 huid 作账号身份，并把酒店一起存进 credentialExtra', async () => {
    const webContents = createWebContents(
      'https://ebooking.ctrip.com/home/mainland',
      HE_APP_INFO_SAMPLE,
    );
    const discover = createCtripDiscovery(createLogger());

    await expect(
      discover('persist:xiaozhi:prod:ctrip:aaa', webContents.getURL(), webContents),
    ).resolves.toEqual({
      kind: 'found',
      credential: {
        // 账号身份是 huid，不是酒店 ID（85068938）。
        channelAccountId: '12324831',
        credentialExtra: {
          huid: '12324831',
          userName: '银际青山店',
          login: '银际酒店青山王府井店',
          userType: 'HOTEL',
          // 酒店随身份一起存下来，供 ctripHotelProbe 读取（它不碰页面）。
          masterHotelId: '85068938',
          hotelName: '银际酒店(包头市青山王府井文化路店)',
          identitySource: 'he-app-info',
        },
      },
    });
    // 身份读取是纯查询，不得操作页面。
    expect(webContents.loadURL).not.toHaveBeenCalled();
    expect(webContents.close).not.toHaveBeenCalled();
  });

  /**
   * 回归 T4：多门店账号此前走 `kind: 'multiple'` → service 返回 null →
   * 门店探测被完全跳过，绑不了店。身份改用 huid 后与门店数量无关。
   */
  it('账号管多家门店时照常产出身份，不再放弃', async () => {
    const webContents = createWebContents('https://ebooking.ctrip.com/home/mainland', {
      ...HE_APP_INFO_SAMPLE,
      masterHotelId: 85068938,
    });
    const discover = createCtripDiscovery(createLogger());

    const result = await discover(
      'persist:xiaozhi:prod:ctrip:bbb',
      webContents.getURL(),
      webContents,
    );

    expect(result.kind).toBe('found');
  });

  /** SDK 未就绪时退回同步的 HEUbtBaseData，字段较少但账号身份齐全。 */
  it('HEAppInfo 缺席时接受 HEUbtBaseData 兜底结果', async () => {
    const webContents = createWebContents('https://ebooking.ctrip.com/home/mainland', {
      huid: 12324831,
      userName: '银际青山店',
      login: null,
      userType: 'HOTEL',
      masterHotelId: 85068938,
      hotelName: '银际酒店(包头市青山王府井文化路店)',
      identitySource: 'he-ubt-base-data',
    });
    const discover = createCtripDiscovery(createLogger());

    const result = await discover(
      'persist:xiaozhi:prod:ctrip:fff',
      webContents.getURL(),
      webContents,
    );

    expect(result).toMatchObject({
      kind: 'found',
      credential: {
        channelAccountId: '12324831',
        credentialExtra: { identitySource: 'he-ubt-base-data', login: null },
      },
    });
  });

  it('当前页面不是受信任携程商家后台时拒绝执行脚本', async () => {
    const logger = createLogger();
    const webContents = createWebContents('https://ebooking.ctrip.com.evil.example/home', null);
    const discover = createCtripDiscovery(logger);

    await expect(
      discover('persist:xiaozhi:prod:ctrip:ccc', webContents.getURL(), webContents),
    ).resolves.toEqual({ kind: 'none' });
    expect(webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Ctrip discovery rejected untrusted current URL');
  });

  it('缺 huid 时判失败——没有账号身份就不该建 credential', async () => {
    const webContents = createWebContents('https://ebooking.ctrip.com/home/mainland', {
      userName: '银际青山店',
      masterHotelId: 85068938,
      identitySource: 'he-app-info',
    });

    await expect(
      discover(webContents),
    ).resolves.toEqual({ kind: 'none' });

    function discover(target: WebContents) {
      return createCtripDiscovery(createLogger())(
        'persist:xiaozhi:prod:ctrip:ggg',
        target.getURL(),
        target,
      );
    }
  });

  it('页面没有身份对象与解析失败记成两句不同的 warn', async () => {
    const absentLogger = createLogger();
    const absent = createWebContents('https://ebooking.ctrip.com/home/mainland', null);
    await createCtripDiscovery(absentLogger)(
      'persist:xiaozhi:prod:ctrip:hhh',
      absent.getURL(),
      absent,
    );
    expect(absentLogger.warn).toHaveBeenCalledWith(
      'Ctrip discovery: neither HEAppInfo nor HEUbtBaseData exposed an account',
    );

    const unparsableLogger = createLogger();
    const unparsable = createWebContents('https://ebooking.ctrip.com/home/mainland', {
      unexpected: 'shape',
    });
    await createCtripDiscovery(unparsableLogger)(
      'persist:xiaozhi:prod:ctrip:iii',
      unparsable.getURL(),
      unparsable,
    );
    expect(unparsableLogger.warn).toHaveBeenCalledWith(
      'Ctrip discovery: account identity could not be parsed',
    );
  });

  it('脚本执行失败时返回 none', async () => {
    const webContents = createWebContents('https://ebooking.ctrip.com/home/mainland', null);
    vi.mocked(webContents.executeJavaScript).mockRejectedValue(new Error('boom'));

    await expect(
      createCtripDiscovery(createLogger())(
        'persist:xiaozhi:prod:ctrip:eee',
        webContents.getURL(),
        webContents,
      ),
    ).resolves.toEqual({ kind: 'none' });
  });
});
