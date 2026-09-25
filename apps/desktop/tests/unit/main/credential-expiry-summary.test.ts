import { describe, expect, it } from 'vitest';
import { toCredentialExpirySummary } from '../../../src/main/composition/credential-expiry-summary';
import type { ScanTarget } from '../../../src/main/channels/inventory-scan-dispatcher';
import { toChannelId, toOtaCredentialId } from '../../../src/main/ids';
import type { OtaCredential } from '../../../src/shared/types/ota-credential';

const CTRIP = toChannelId('ctrip');
const MEITUAN = toChannelId('meituan');

function target(channel: typeof CTRIP, partitionName: string, otaHotelId: string): ScanTarget {
  return { channel, partitionName, otaHotelId, channelExtra: {} };
}

function credential(overrides: Partial<OtaCredential>): OtaCredential {
  return {
    id: toOtaCredentialId('credential-1'),
    channel: MEITUAN,
    channelAccountId: null,
    channelAccountName: null,
    partitionName: 'p',
    credentialExtra: null,
    discoveredAt: 1,
    lastRefreshedAt: null,
    ...overrides,
  };
}

describe('toCredentialExpirySummary', () => {
  // ⚠️ 美团一个账号挂多店：多店失效只能算一个账号，否则提醒里同一个号出现两次。
  it('同一账号两家门店失效 → 一个账号、两个门店名', () => {
    const meituan = credential({
      partitionName: 'mt',
      channelAccountName: 'YunduojiudianAI',
      credentialExtra: {
        pois: [
          { poiId: '1', poiName: '云朵酒店' },
          { poiId: '2', poiName: '云朵二店' },
        ],
      },
    });

    const summary = toCredentialExpirySummary(
      [target(MEITUAN, 'mt', '1'), target(MEITUAN, 'mt', '2')],
      () => meituan,
    );

    expect(summary).toEqual({
      accounts: [
        { channel: 'meituan', accountName: 'YunduojiudianAI', hotelNames: ['云朵酒店', '云朵二店'] },
      ],
    });
  });

  it('携程门店名只在 ID 与 masterHotelId 对得上时取', () => {
    const ctrip = credential({
      channel: CTRIP,
      partitionName: 'ct',
      credentialExtra: { masterHotelId: '122244992', hotelName: '云朵酒店(包头机场店)' },
    });

    const summary = toCredentialExpirySummary(
      [target(CTRIP, 'ct', '122244992'), target(CTRIP, 'ct', '999')],
      () => ctrip,
    );

    expect(summary.accounts[0]?.hotelNames).toEqual(['云朵酒店(包头机场店)']);
  });

  it('凭证里没有任何名字时回退账号 ID', () => {
    const meituan = credential({ partitionName: 'mt', channelAccountId: '294870321' });

    const summary = toCredentialExpirySummary([target(MEITUAN, 'mt', '1')], () => meituan);

    expect(summary.accounts).toEqual([
      { channel: 'meituan', accountName: '294870321', hotelNames: [] },
    ]);
  });
});
