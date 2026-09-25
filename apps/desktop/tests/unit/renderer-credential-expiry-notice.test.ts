import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_EXPIRY_NOTICE_ID,
  toCredentialExpiryNotice,
} from '../../src/renderer/credential-expiry-notice';

describe('toCredentialExpiryNotice', () => {
  it('无失效账号 → null（调用方据此收起提醒）', () => {
    expect(toCredentialExpiryNotice({ accounts: [] })).toBeNull();
  });

  it('单个账号：一句话模板，门店名为空不加括号', () => {
    const notice = toCredentialExpiryNotice({
      accounts: [{ channel: 'meituan', accountName: 'YunduojiudianAI', hotelNames: [] }],
    });

    expect(notice).toEqual({
      id: CREDENTIAL_EXPIRY_NOTICE_ID,
      tone: 'error',
      durationMs: 10_000,
      title: '渠道账号登录已过期',
      message: '您的美团酒店账号「YunduojiudianAI」登录已过期，请及时登录，避免影响价量态追齐。',
    });
  });

  it('多个账号：逐行列出，带门店名', () => {
    const notice = toCredentialExpiryNotice({
      accounts: [
        { channel: 'meituan', accountName: 'YunduojiudianAI', hotelNames: ['云朵酒店'] },
        { channel: 'ctrip', accountName: '运营商赵经理', hotelNames: ['云朵酒店(包头机场店)'] },
      ],
    });

    expect(notice?.title).toBe('2 个渠道账号登录已过期');
    expect(notice?.message).toBe(
      [
        '请及时登录，避免影响价量态追齐：',
        '美团酒店「YunduojiudianAI」（云朵酒店）',
        '携程「运营商赵经理」（云朵酒店(包头机场店)）',
      ].join('\n'),
    );
  });
});

describe('toCredentialExpiryNotice —— 列表折叠', () => {
  it('门店超过 2 家：列前两家，其余折成「等共 N 家门店」', () => {
    const notice = toCredentialExpiryNotice({
      accounts: [
        { channel: 'meituan', accountName: 'X', hotelNames: ['A店', 'B店', 'C店', 'D店', 'E店'] },
      ],
    });
    expect(notice?.message).toBe(
      '您的美团酒店账号「X」（A店、B店 等共 5 家门店）登录已过期，请及时登录，避免影响价量态追齐。',
    );
  });

  it('账号超过 2 个：列前两个，末行「等共 N 个账号」', () => {
    const account = (name: string) => ({ channel: 'ctrip', accountName: name, hotelNames: [] });
    const notice = toCredentialExpiryNotice({
      accounts: [account('甲'), account('乙'), account('丙'), account('丁')],
    });
    expect(notice?.title).toBe('4 个渠道账号登录已过期');
    expect(notice?.message).toBe(
      ['请及时登录，避免影响价量态追齐：', '携程「甲」', '携程「乙」', '等共 4 个账号'].join('\n'),
    );
  });
});
