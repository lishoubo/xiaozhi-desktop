import { describe, expect, it } from 'vitest';
import { douyinLoginUrlMatcher } from '../../../src/main/channels/douyin/login-url-matcher';

describe('douyinLoginUrlMatcher', () => {
  it('停在登录页时判定为尚未登录成功', () => {
    expect(douyinLoginUrlMatcher.isPastLogin('https://life.douyin.com/p/login')).toBe(false);
  });

  it('落地到 /p/home 但没有 groupid（停在选公司中间态）时判定为尚未登录成功', () => {
    expect(douyinLoginUrlMatcher.isPastLogin('https://life.douyin.com/p/home')).toBe(false);
  });

  it('落地到 /p/home 且带 groupid 时判定为登录成功', () => {
    expect(
      douyinLoginUrlMatcher.isPastLogin('https://life.douyin.com/p/home?groupid=1813179858562059'),
    ).toBe(true);
  });

  it('无法解析为合法 URL 时判定为尚未登录成功', () => {
    expect(douyinLoginUrlMatcher.isPastLogin('not-a-url')).toBe(false);
  });
});
