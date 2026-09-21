import { describe, expect, it, vi } from 'vitest';
import { createMeituanDiscovery } from '../../../src/main/channels/meituan/discovery';

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('createMeituanDiscovery', () => {
  it('直接在当前可信美团页面读取账号身份', async () => {
    const executeJavaScript = vi
      .fn()
      // ① 账号身份
      .mockResolvedValueOnce({
        kind: 'completed',
        candidates: [
          {
            candidateAccountId: '274615733',
            response: {
              code: 10000,
              data: { bizAcctId: '274615733', partnerId: '4595635' },
            },
          },
        ],
      })
      // ② 门店清单 —— 扫描的枚举口径读它，见 discovery.ts 文件头
      .mockResolvedValueOnce({
        code: 10000,
        data: {
          twoLevelList: [
            { poiList: [{ poiId: 1834077877, poiName: '苏州平江府', partnerId: 4595635 }] },
          ],
        },
      });
    const webContents = {
      getURL: vi.fn(() => 'https://me.meituan.com/ebooking/index.html'),
      executeJavaScript,
    };

    await expect(
      createMeituanDiscovery(logger())(
        'persist:xiaozhi:prod:meituan:one',
        'https://me.meituan.com/ebooking/index.html',
        webContents as never,
      ),
    ).resolves.toEqual({
      kind: 'found',
      credential: {
        channelAccountId: '274615733',
        credentialExtra: {
          partnerId: '4595635',
          login: null,
          accountType: null,
          accountStatus: null,
          maskedPhone: null,
          // ⚠️ 门店级 otaPartnerId 与外层那个账号级 partnerId 恰好同值只是巧合 ——
          // 它们来自不同端点，一般不相等。
          pois: [{ poiId: '1834077877', otaPartnerId: '4595635', poiName: '苏州平江府' }],
        },
      },
    });
    // 两次：① 账号身份 ② 门店清单。都在**当前页面**读，不开新标签页、不导航。
    expect(executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it('即使 landingUrl 可信，当前页面不是美团域时也拒绝执行', async () => {
    const executeJavaScript = vi.fn();
    const webContents = {
      getURL: vi.fn(() => 'https://example.com/ebooking/index.html'),
      executeJavaScript,
    };

    await expect(
      createMeituanDiscovery(logger())(
        'persist:xiaozhi:prod:meituan:one',
        'https://me.meituan.com/ebooking/index.html',
        webContents as never,
      ),
    ).resolves.toEqual({ kind: 'none' });
    expect(executeJavaScript).not.toHaveBeenCalled();
  });

  // ⚠️ 账号身份才是这一步的交付物。门店清单缺了只是扫描不跑，下次登录会重新写 ——
  // 不该因此让整个登录失败。
  it('门店清单取不到时仍然返回账号身份，pois 为空数组', async () => {
    const executeJavaScript = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'completed',
        candidates: [
          {
            candidateAccountId: '274615733',
            response: { code: 10000, data: { bizAcctId: '274615733', partnerId: '4595635' } },
          },
        ],
      })
      .mockRejectedValueOnce(new Error('network'));
    const webContents = {
      getURL: vi.fn(() => 'https://me.meituan.com/ebooking/index.html'),
      executeJavaScript,
    };

    const result = await createMeituanDiscovery(logger())(
      'persist:xiaozhi:prod:meituan:one',
      'https://me.meituan.com/ebooking/index.html',
      webContents as never,
    );

    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    // ⚠️ 空数组而不是省略该键：空数组说明「探测过，没有门店」，
    // 省略说明「没探测过」，两者对排查的意义不同。
    expect(result.credential.credentialExtra.pois).toEqual([]);
  });

  // 多店账号天然产出多条，不做「取第一家」的取舍。
  it('探测到几家就记几家', async () => {
    const executeJavaScript = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'completed',
        candidates: [
          {
            candidateAccountId: '274615733',
            response: { code: 10000, data: { bizAcctId: '274615733', partnerId: '4595635' } },
          },
        ],
      })
      .mockResolvedValueOnce({
        code: 10000,
        data: {
          twoLevelList: [
            {
              poiList: [
                { poiId: 1, poiName: 'A 店', partnerId: 11 },
                { poiId: 2, poiName: 'B 店', partnerId: 22 },
              ],
            },
          ],
        },
      });
    const webContents = {
      getURL: vi.fn(() => 'https://me.meituan.com/ebooking/index.html'),
      executeJavaScript,
    };

    const result = await createMeituanDiscovery(logger())(
      'persist:xiaozhi:prod:meituan:one',
      'https://me.meituan.com/ebooking/index.html',
      webContents as never,
    );

    if (result.kind !== 'found') throw new Error('expected found');
    expect(result.credential.credentialExtra.pois).toEqual([
      { poiId: '1', otaPartnerId: '11', poiName: 'A 店' },
      { poiId: '2', otaPartnerId: '22', poiName: 'B 店' },
    ]);
  });
});