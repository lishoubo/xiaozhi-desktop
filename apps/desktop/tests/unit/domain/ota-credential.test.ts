import { describe, expect, it } from 'vitest';
import { toChannelId, toOtaCredentialId } from '../../../src/domain/identity';
import { createOtaCredential, InvalidOtaCredentialError } from '../../../src/domain/ota-credential';

function input(overrides: Partial<Parameters<typeof createOtaCredential>[0]> = {}) {
  return {
    id: toOtaCredentialId('credential-1'),
    channel: toChannelId('douyin'),
    partitionName: 'persist:xiaozhi:prod:douyin:short-id',
    credentialExtra: null,
    discoveredAt: 1_700_000_000_000,
    lastRefreshedAt: null,
    ...overrides,
  };
}

describe('createOtaCredential', () => {
  it('创建一条持有 partition 指针的登录态', () => {
    const credential = createOtaCredential(input());
    expect(credential.partitionName).toBe('persist:xiaozhi:prod:douyin:short-id');
    expect(credential.credentialExtra).toBeNull();
  });

  it('拒绝空 partitionName', () => {
    expect(() => createOtaCredential(input({ partitionName: '' }))).toThrow(
      InvalidOtaCredentialError,
    );
  });

  it('保留结构化 credentialExtra', () => {
    const credential = createOtaCredential(input({ credentialExtra: { loginId: 'login-1' } }));
    expect(credential.credentialExtra).toEqual({ loginId: 'login-1' });
  });
});
