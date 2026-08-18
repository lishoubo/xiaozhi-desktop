import { describe, expect, it } from 'vitest';
import {
  RMS_ERROR,
  isAccessTokenRejected,
  messageForRmsError,
} from '../../../src/main/staff-auth/rms-auth-errors';

const FALLBACK = '登录失败，请稍后重试';

describe('短信登录错误文案', () => {
  it.each([
    [RMS_ERROR.phoneCodeSendTooFrequent, '发送太频繁了，请 60 秒后再试'],
    [RMS_ERROR.phoneCodeInvalid, '验证码错误或已过期'],
    [RMS_ERROR.phoneCodeAttemptsExceeded, '错误次数过多，请 15 分钟后再试'],
    [RMS_ERROR.phoneNumberUnavailable, '该手机号不可用，请联系管理员'],
    [RMS_ERROR.phoneCodeSendFailed, '验证码发送失败，请稍后再试'],
  ])('码 %i 映射到专属文案', (code, expected) => {
    expect(messageForRmsError(code, FALLBACK)).toBe(expected);
  });

  it('五个短信错误码的文案两两不同', () => {
    const messages = [
      RMS_ERROR.phoneCodeSendTooFrequent,
      RMS_ERROR.phoneCodeInvalid,
      RMS_ERROR.phoneCodeAttemptsExceeded,
      RMS_ERROR.phoneNumberUnavailable,
      RMS_ERROR.phoneCodeSendFailed,
    ].map((code) => messageForRmsError(code, FALLBACK));

    expect(new Set(messages).size).toBe(messages.length);
    expect(messages).not.toContain(FALLBACK);
  });

  // 11011 的锁定 15 分钟自动解除，11003 的锁定无 TTL、只能由管理员处理。
  // 两者文案互抄会把用户引向完全错误的行动。
  it('区分"验证码错误次数过多"与"账号被锁定"', () => {
    const attempts = messageForRmsError(RMS_ERROR.phoneCodeAttemptsExceeded, FALLBACK);
    const locked = messageForRmsError(RMS_ERROR.accountLocked, FALLBACK);

    expect(attempts).not.toBe(locked);
    expect(attempts).toContain('15 分钟');
    expect(locked).toContain('联系管理员');
    expect(locked).not.toContain('分钟');
  });

  it('密码登录的文案未被短信改动波及', () => {
    expect(messageForRmsError(RMS_ERROR.usernameOrPasswordInvalid, FALLBACK)).toBe(
      '用户名或密码错误',
    );
    expect(messageForRmsError(RMS_ERROR.refreshTokenInvalid, FALLBACK)).toBe(
      '登录已过期，请重新登录',
    );
  });

  it('未知码回落到调用方给的兜底文案', () => {
    expect(messageForRmsError(99_999, FALLBACK)).toBe(FALLBACK);
  });

  // 这五个码都不是 access token 失效信号，不得触发 refresh 重试。
  it('短信错误码不被当作 access token 失效', () => {
    for (const code of [
      RMS_ERROR.phoneCodeSendTooFrequent,
      RMS_ERROR.phoneCodeInvalid,
      RMS_ERROR.phoneCodeAttemptsExceeded,
      RMS_ERROR.phoneNumberUnavailable,
      RMS_ERROR.phoneCodeSendFailed,
    ]) {
      expect(isAccessTokenRejected(code)).toBe(false);
    }
    expect(isAccessTokenRejected(RMS_ERROR.tokenExpired)).toBe(true);
    expect(isAccessTokenRejected(RMS_ERROR.tokenInvalid)).toBe(true);
  });
});
