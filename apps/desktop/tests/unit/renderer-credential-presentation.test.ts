import { describe, expect, it } from 'vitest';
import type { OtaCredentialDto } from '../../src/shared/browser';
import { credentialPresentation } from '../../src/renderer/hotel-management/credential-presentation';

function credential(overrides: Partial<OtaCredentialDto> = {}): OtaCredentialDto {
  return {
    id: 'credential-1',
    channel: 'douyin',
    channelAccountId: 'account-1',
    channelAccountName: null,
    partitionName: 'persist:xiaozhi:prod:douyin:aaa',
    credentialExtra: null,
    discoveredAt: 1,
    lastRefreshedAt: null,
    ...overrides,
  };
}

describe('credentialPresentation', () => {
  it('展开抖音 extra：只上角色，loginId 与数字码 roleType 都不上屏', () => {
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
      // loginId 存着但不上屏：抖音返回的值与 user_id 相同，两行同一个数字帮不上忙。
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

  it('展开携程 extra：标题取账号名，酒店退为佐证，identitySource 不上屏', () => {
    const presentation = credentialPresentation(
      credential({
        channel: 'ctrip',
        channelAccountId: '12324831',
        credentialExtra: {
          huid: '12324831',
          userName: '银际青山店',
          login: '银际酒店青山王府井店',
          userType: 'HOTEL',
          masterHotelId: '85068938',
          hotelName: '银际酒店(包头市青山王府井文化路店)',
          identitySource: 'he-app-info',
        },
      }),
    );

    // 账号名而非酒店名：一个账号可管多店，用店名认账号会串。
    expect(presentation.title).toBe('银际青山店');
    expect(presentation.details).toEqual([
      { label: '账号 ID', value: '12324831' },
      { label: '酒店 ID', value: '85068938' },
      { label: '酒店', value: '银际酒店(包头市青山王府井文化路店)' },
      // `login` 是美团那一列的标签，携程也有同名键，一并展示不冲突。
      { label: '登录名', value: '银际酒店青山王府井店' },
    ]);
  });

  /** 老记录不迁移：没有 `userName`，标题退回酒店名，`hotelId` 仍要上屏。 */
  it('携程老记录退回酒店名与 hotelId', () => {
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
      { label: '酒店', value: '平江府' },
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
