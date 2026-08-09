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

  it('shows the bound account identity and drops the per-channel RPA parameters', () => {
    // merchantGroupId / otaPartnerId 是绑定与更新时传给远端的入参，运营看不懂也用不上。
    expect(
      getOtaAccountBindDetails({
        bindSource: 'DESKTOP',
        channelAccountId: '7129084416',
        channelAccountName: '璞禾咖啡酒店',
        merchantGroupId: '7129084416',
        otaPartnerId: 'MT-883720',
      }),
    ).toEqual([
      { label: '账号名称', value: '璞禾咖啡酒店' },
      { label: '账号 ID', value: '7129084416' },
      { label: '绑定来源', value: '桌面端' },
    ]);
  });

  it('spells out an unrecognised bind source rather than hiding it', () => {
    expect(getOtaAccountBindDetails({ bindSource: 'RPA' })).toEqual([
      { label: '绑定来源', value: 'RPA' },
    ]);
  });

  it('treats a missing bind source as bound in RMS', () => {
    // 服务端只在 desktop 绑定时写 bindSource=DESKTOP；缺失即后台绑的。
    expect(getOtaAccountBindDetails({ channelAccountName: '璞禾咖啡酒店' })).toEqual([
      { label: '账号名称', value: '璞禾咖啡酒店' },
      { label: '绑定来源', value: 'RMS 绑定' },
    ]);
  });

  it('labels an explicit RMS bind source the same way, whatever its casing', () => {
    expect(getOtaAccountBindDetails({ bindSource: 'rms' })).toEqual([
      { label: '绑定来源', value: 'RMS 绑定' },
    ]);
  });

  it('ignores fields outside the response contract', () => {
    // loginMethod / loginPhone 是 RPA 账密绑定的内部细节，服务端不回吐（loginPhone
    // 还是手机号）。即便某个环境吐了，desktop 也不展示。
    expect(getOtaAccountBindDetails({ loginMethod: 'SMS', loginPhone: '180****2468' })).toEqual([
      { label: '绑定来源', value: 'RMS 绑定' },
    ]);
  });

  it('shows only the source for a binding that carries channel parameters alone', () => {
    // 后台绑的老记录往往只有这些渠道参数——没有账号身份可展示，但来源仍然要说清楚。
    expect(
      getOtaAccountBindDetails({ merchantGroupId: '7129084416', otaPartnerId: 'MT-883720' }),
    ).toEqual([{ label: '绑定来源', value: 'RMS 绑定' }]);
  });

  it('still reports RMS as the source when bindExtra is absent entirely', () => {
    // 没有 bindExtra 正是后台绑定最典型的样子——不写来源，不代表没有来源。
    expect(getOtaAccountBindDetails(null)).toEqual([{ label: '绑定来源', value: 'RMS 绑定' }]);
  });
});
