import { describe, expect, it } from 'vitest';
import {
  getOtaAccountBindDetails,
  getOtaAccountPresentation,
} from '../../src/renderer/hotel-management/model';

describe('hotel management OTA account presentation', () => {
  it('presents a healthy bound account without a recovery action', () => {
    expect(getOtaAccountPresentation('BOUND')).toEqual({
      label: '绑定成功',
      description: '账号连接正常',
      tone: 'healthy',
      action: null,
    });
  });

  it.each(['LOGIN_FAILED', 'LOGIN_EXPIRED', 'UNBOUND'])(
    'offers login recovery for %s',
    (status) => {
      expect(getOtaAccountPresentation(status).action).toBe('login');
    },
  );

  it.each(['IN_PROGRESS', 'WAITING_CAPTCHA'])(
    'asks the user to wait rather than act on %s',
    (status) => {
      // RPA 正在跑：此时重复提交会撞唯一键或打断流程，所以不给任何入口。
      expect(getOtaAccountPresentation(status)).toMatchObject({
        label: '处理中',
        tone: 'progress',
        action: null,
      });
    },
  );

  it.each(['PENDING_LOGIN', 'HOTEL_NAME_MISMATCH', 'HOTEL_NAME_AMBIGUOUS', 'INIT_FAILED'])(
    'routes %s to the administrator instead of offering self-service',
    (status) => {
      // 这些卡在登录之后的环节，重新登录解决不了，只能在 Admin 侧处理。
      expect(getOtaAccountPresentation(status)).toMatchObject({
        label: '绑定错误',
        description: '请联系管理员',
        action: null,
      });
    },
  );

  it('treats a server-added status as a binding error rather than a silent unknown', () => {
    // 新状态多半也是异常，与其显示"状态待确认"让用户干等，不如指向管理员。
    expect(getOtaAccountPresentation('SERVER_ADDED_STATUS')).toMatchObject({
      label: '绑定错误',
      description: '请联系管理员',
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
