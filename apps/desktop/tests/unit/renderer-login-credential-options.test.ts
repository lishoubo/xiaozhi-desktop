import { describe, expect, it } from 'vitest';
import type { OtaCredentialDto } from '../../src/shared/browser';
import { buildLoginCredentialOptions } from '../../src/renderer/components/browser/login-credential-options';

function credential(id: string, partitionName: string, discoveredAt: number): OtaCredentialDto {
  return {
    id,
    channel: 'meituan',
    channelAccountId: '274615733',
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
});
