import { describe, expect, it } from 'vitest';
import {
  parseMeituanAccountDetail,
  parseMeituanAccountIdentityCandidates,
} from '../../../src/main/channels/meituan/account-identity';

describe('parseMeituanAccountDetail', () => {
  it('校验 bizAcctId 并只返回账号白名单字段', () => {
    expect(
      parseMeituanAccountDetail('274615733', {
        code: 10000,
        data: {
          bizAcctId: 274615733,
          partnerId: 4595635,
          login: 'hotel-login',
          accountType: 1,
          status: 1,
          maskPhone: '138****1234',
          organizationIds: ['secret-organization'],
          ebRoleList: [{ id: 'secret-role' }],
        },
      }),
    ).toEqual({
      channelAccountId: '274615733',
      credentialExtra: {
        partnerId: '4595635',
        login: 'hotel-login',
        accountType: 1,
        accountStatus: 1,
        maskedPhone: '138****1234',
      },
    });
  });

  it('账号详情 ID 与 globalStorage 候选不一致时拒绝结果', () => {
    expect(
      parseMeituanAccountDetail('274615733', {
        code: 10000,
        data: { bizAcctId: 'other-account' },
      }),
    ).toBeNull();
  });

  it('响应码或账号 ID 无效时拒绝结果', () => {
    expect(parseMeituanAccountDetail('274615733', { code: 500, data: {} })).toBeNull();
    expect(
      parseMeituanAccountDetail('274615733', { code: 10000, data: { bizAcctId: '' } }),
    ).toBeNull();
  });

  it('从同源脚本结果中选择首个可校验的账号候选', () => {
    expect(
      parseMeituanAccountIdentityCandidates({
        kind: 'completed',
        candidates: [
          { candidateAccountId: 'stale', response: { code: 500 } },
          {
            candidateAccountId: '274615733',
            response: { code: 10000, data: { bizAcctId: '274615733' } },
          },
        ],
      }),
    ).toEqual({
      channelAccountId: '274615733',
      credentialExtra: {
        partnerId: null,
        login: null,
        accountType: null,
        accountStatus: null,
        maskedPhone: null,
      },
    });
  });
});
