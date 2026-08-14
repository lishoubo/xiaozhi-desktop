import { describe, expect, it } from 'vitest';
import type { OtaCredentialDto } from '../../src/shared/browser';
import { buildLoginCredentialOptions } from '../../src/renderer/components/browser/login-credential-options';

function credential(id: string, partitionName: string, discoveredAt: number): OtaCredentialDto {
  return {
    id,
    channel: 'meituan',
    channelAccountId: '274615733',
    channelAccountName: 'Btphhldxm',
    partitionName,
    credentialExtra: { login: 'Btphhldxm' },
    discoveredAt,
    lastRefreshedAt: discoveredAt,
  };
}

describe('buildLoginCredentialOptions', () => {
  const older = credential('older', 'persist:xiaozhi:prod:meituan:older', 1);
  const newer = credential('newer', 'persist:xiaozhi:prod:meituan:newer', 2);

  it('同一渠道账号存在多个 partition 时只展示最新 credential', () => {
    expect(
      buildLoginCredentialOptions([older, newer]).map((option) => option.credential.id),
    ).toEqual(['newer']);
  });

  it('当前活动 partition 较旧时优先保留当前 credential', () => {
    expect(
      buildLoginCredentialOptions([older, newer], older.partitionName).map(
        (option) => option.credential.id,
      ),
    ).toEqual(['older']);
  });

  /**
   * 携程标签取账号名而非酒店名：一个账号可以管多家门店，用门店名认账号在多店
   * 场景下会串。老记录没有 `userName`，才退回 `hotelName`。
   */
  it('携程标签优先账号名，老记录退回酒店名', () => {
    const ctrip = (id: string, extra: OtaCredentialDto['credentialExtra']): OtaCredentialDto => ({
      id,
      channel: 'ctrip',
      channelAccountId: id,
      channelAccountName: null,
      partitionName: `persist:xiaozhi:prod:ctrip:${id}`,
      credentialExtra: extra,
      discoveredAt: 1,
      lastRefreshedAt: 1,
    });

    expect(
      buildLoginCredentialOptions([
        ctrip('new', {
          userName: '银际青山店',
          hotelName: '银际酒店(包头市青山王府井文化路店)',
        }),
        ctrip('old', { hotelId: 'ct-1', hotelName: '平江府' }),
      ]).map((option) => option.label),
    ).toEqual(['银际青山店', '平江府']);
  });
});
