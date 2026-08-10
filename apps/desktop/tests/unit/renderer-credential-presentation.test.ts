import { describe, expect, it } from 'vitest';
import type { OtaCredentialDto } from '../../src/shared/browser';
import { credentialPresentation } from '../../src/renderer/hotel-management/credential-presentation';

function credential(overrides: Partial<OtaCredentialDto> = {}): OtaCredentialDto {
  return {
    id: 'credential-1',
    channel: 'douyin',
    channelAccountId: 'account-1',
    partitionName: 'persist:xiaozhi:prod:douyin:aaa',
    credentialExtra: null,
    discoveredAt: 1,
    lastRefreshedAt: null,
    ...overrides,
  };
}

describe('credentialPresentation', () => {
  it('展开抖音 extra：登录 ID 与角色，数字码 roleType 不上屏', () => {
    const presentation = credentialPresentation(
      credential({
        credentialExtra: {
          loginId: '18800000000',
          name: '云朵酒店',
          roleName: '管理员',
          roleType: 2,
        },
      }),
    );

    expect(presentation.title).toBe('云朵酒店');
    expect(presentation.details).toEqual([
      { label: '账号 ID', value: 'account-1' },
      { label: '登录 ID', value: '18800000000' },
      { label: '角色', value: '管理员' },
    ]);
  });

  it('展开美团 extra：商家 ID、登录名、手机号', () => {
    const presentation = credentialPresentation(
      credential({
        channel: 'meituan',
        channelAccountId: 'biz-9',
        credentialExtra: {
          partnerId: 'partner-7',
          login: 'yunduo01',
          accountType: 1,
          accountStatus: 0,
          maskedPhone: '188****0000',
        },
      }),
    );

    // 美团 extra 里既没有 hotelName 也没有 name，标题退到 login 而不是一串 ID。
    expect(presentation.title).toBe('yunduo01');
    expect(presentation.details).toEqual([
      { label: '账号 ID', value: 'biz-9' },
      { label: '商家 ID', value: 'partner-7' },
      { label: '登录名', value: 'yunduo01' },
      { label: '手机号', value: '188****0000' },
    ]);
  });

  it('展开携程 extra：酒店 ID，内部标记 identitySource 不上屏', () => {
    const presentation = credentialPresentation(
      credential({
        channel: 'ctrip',
        channelAccountId: 'ct-123',
        credentialExtra: { hotelId: 'ct-123', hotelName: '平江府', identitySource: 'hotel-dom' },
      }),
    );

    expect(presentation.title).toBe('平江府');
    expect(presentation.details).toEqual([
      { label: '账号 ID', value: 'ct-123' },
      { label: '酒店 ID', value: 'ct-123' },
    ]);
  });

  it('extra 缺失时标题退到渠道账号 ID，再退到本地凭证 ID', () => {
    expect(credentialPresentation(credential()).title).toBe('account-1');
    expect(credentialPresentation(credential({ channelAccountId: null })).title).toBe(
      'credential-1',
    );
  });

  it('空白值不占位', () => {
    const presentation = credentialPresentation(
      credential({ credentialExtra: { loginId: '   ', roleName: '' } }),
    );

    expect(presentation.details).toEqual([{ label: '账号 ID', value: 'account-1' }]);
  });
});
