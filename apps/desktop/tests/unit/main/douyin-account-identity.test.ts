import { describe, expect, it } from 'vitest';
import {
  parseDouyinAccountIdentity,
  READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION,
} from '../../../src/main/ota/douyin/account-identity';

describe('parseDouyinAccountIdentity', () => {
  it('使用 user_id 作为渠道账号 ID 并只保留白名单字段', () => {
    expect(
      parseDouyinAccountIdentity({
        user_id: 104680039472,
        login_id: '104680039472',
        name: '走进内蒙古',
        role_name: '商家子账号',
        role_type: 1,
        login_status: 1,
        avatar: 'https://example.com/private-avatar',
        token: 'must-not-persist',
      }),
    ).toEqual({
      channelAccountId: '104680039472',
      credentialExtra: {
        loginId: '104680039472',
        name: '走进内蒙古',
        roleName: '商家子账号',
        roleType: 1,
      },
    });
  });

  it('任一必需身份字段缺失或 user_id 无效时拒绝', () => {
    expect(parseDouyinAccountIdentity({ user_id: ' user-1 ' })).toBeNull();
    expect(parseDouyinAccountIdentity({ login_id: 'login-only' })).toBeNull();
    expect(parseDouyinAccountIdentity({ user_id: '   ' })).toBeNull();
  });

  it('页面表达式从当前 URL 和 getAccountDetail 分别读取两个请求参数', () => {
    expect(READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION).toContain(
      "fetch('/life/gate/v1/user/login_info/?'",
    );
    expect(READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION).toContain(
      'new URLSearchParams({ groupId, accountId })',
    );
    expect(READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION).toContain('accountData?.account_id');
    expect(READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION).toContain("credentials: 'include'");
  });

  it('页面表达式只返回登录接口 data 中的白名单字段', async () => {
    const evaluate = new Function(
      'fetch',
      'location',
      'sessionStorage',
      `return (${READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION.trim()})`,
    ) as (
      request: typeof fetch,
      pageLocation: Pick<Location, 'href'>,
      storage: Pick<Storage, 'getItem'>,
    ) => Promise<unknown>;
    let requestedUrl = '';

    await expect(
      evaluate(
        async (input) => {
          requestedUrl = String(input);
          return new Response(
            JSON.stringify({
              data: {
                user_id: '104680039472',
                login_id: '104680039472',
                name: '走进内蒙古',
                role_name: '商家子账号',
                role_type: 1,
                login_status: 1,
                token: 'must-not-return',
              },
            }),
            { status: 200 },
          );
        },
        { href: 'https://life.douyin.com/p/home?groupid=1808569915022548' },
        {
          getItem: () =>
            JSON.stringify({
              getAccountDetail: { data: { account_id: '1801259354396852' } },
            }),
        },
      ),
    ).resolves.toEqual({
      user_id: '104680039472',
      login_id: '104680039472',
      name: '走进内蒙古',
      role_name: '商家子账号',
      role_type: 1,
    });
    expect(requestedUrl).toBe(
      '/life/gate/v1/user/login_info/?groupId=1808569915022548&accountId=1801259354396852',
    );
  });

  it('登录信息接口失败时返回 null', async () => {
    const evaluate = new Function(
      'fetch',
      'location',
      'sessionStorage',
      `return (${READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION.trim()})`,
    ) as (
      request: typeof fetch,
      pageLocation: Pick<Location, 'href'>,
      storage: Pick<Storage, 'getItem'>,
    ) => Promise<unknown>;

    await expect(
      evaluate(
        async () => new Response(null, { status: 500 }),
        {
          href: 'https://life.douyin.com/p/home?groupid=1808569915022548',
        },
        {
          getItem: () =>
            JSON.stringify({ getAccountDetail: { data: { account_id: '1801259354396852' } } }),
        },
      ),
    ).resolves.toBeNull();
  });
});
