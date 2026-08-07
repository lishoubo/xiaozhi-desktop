import { describe, expect, it } from 'vitest';
import { ctripLoginUrlMatcher } from '../../../src/main/features/ota-credential/ota/ctrip/login-url-matcher';

describe('ctripLoginUrlMatcher', () => {
  it('URL 含 /login/ 时判定为尚未登录成功', () => {
    expect(ctripLoginUrlMatcher.isPastLogin('https://ebooking.ctrip.com/login/')).toBe(false);
    expect(
      ctripLoginUrlMatcher.isPastLogin('https://ebooking.ctrip.com/login/?redirect=/home'),
    ).toBe(false);
  });

  it('URL 跳出登录页（单店账号落地到 /hotel/{id}）时判定为登录成功', () => {
    expect(ctripLoginUrlMatcher.isPastLogin('https://ebooking.ctrip.com/hotel/123456')).toBe(true);
  });

  it('URL 跳出登录页（多店账号落地到通用首页）时判定为登录成功', () => {
    expect(ctripLoginUrlMatcher.isPastLogin('https://ebooking.ctrip.com/home/mainland')).toBe(true);
  });

  it('URL 跳到未入驻账号的入驻引导页时判定为登录成功', () => {
    expect(ctripLoginUrlMatcher.isPastLogin('https://ebooking.ctrip.com/hotelSignUp/step1')).toBe(
      true,
    );
  });
});
