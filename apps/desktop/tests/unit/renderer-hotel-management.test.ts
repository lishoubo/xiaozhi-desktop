import { describe, expect, it } from 'vitest';
import {
  getOtaAccountBindDetails,
  getOtaAccountPresentation,
} from '../../src/renderer/hotel-management/model';

describe('hotel management OTA account presentation', () => {
  it('presents a healthy bound account without a recovery action', () => {
    expect(getOtaAccountPresentation('BOUND')).toEqual({
      label: '已绑定',
      description: '账号连接正常',
      tone: 'healthy',
      action: null,
    });
  });

  it('offers login recovery for an expired account', () => {
    expect(getOtaAccountPresentation('LOGIN_EXPIRED')).toEqual({
      label: '登录已失效',
      description: '登录凭证已过期，请重新登录',
      tone: 'error',
      action: 'login',
    });
  });

  it('uses a safe neutral fallback for an unknown server status', () => {
    expect(getOtaAccountPresentation('SERVER_ADDED_STATUS')).toEqual({
      label: '状态待确认',
      description: '暂时无法识别此账号状态',
      tone: 'neutral',
      action: null,
    });
  });

  it('derives labeled channel details from structured bindExtra keys', () => {
    expect(
      getOtaAccountBindDetails({
        merchantGroupId: '7129084416',
        otaPartnerId: 'MT-883720',
        loginMethod: 'SMS',
        loginPhone: '180****2468',
      }),
    ).toEqual([
      { label: '抖音商户 ID', value: '7129084416' },
      { label: '美团 Partner ID', value: 'MT-883720' },
      { label: '登录方式', value: '短信验证码' },
      { label: '登录手机号', value: '180****2468' },
    ]);
  });

  it('ignores null or unknown bindExtra content', () => {
    expect(getOtaAccountBindDetails(null)).toEqual([]);
    expect(getOtaAccountBindDetails({ unknown: 'value' })).toEqual([]);
  });
});
