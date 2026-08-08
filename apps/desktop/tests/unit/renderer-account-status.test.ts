import { describe, expect, it } from 'vitest';
import {
  isActiveBinding,
  needsAttention,
  needsReauth,
} from '../../src/renderer/hotel-management/account-status';

describe('needsReauth', () => {
  it('登录坏掉的状态可以靠重新登录恢复', () => {
    expect(needsReauth('LOGIN_EXPIRED')).toBe(true);
    expect(needsReauth('LOGIN_FAILED')).toBe(true);
  });

  it('还没登完的中间态也走登录入口', () => {
    expect(needsReauth('PENDING_LOGIN')).toBe(true);
    expect(needsReauth('WAITING_CAPTCHA')).toBe(true);
  });

  it('正常绑定与非登录类问题不走重新登录', () => {
    expect(needsReauth('BOUND')).toBe(false);
    // 酒店信息没同步成功，刷新 cookie 不会让它消失
    expect(needsReauth('INIT_FAILED')).toBe(false);
    expect(needsReauth('HOTEL_NAME_MISMATCH')).toBe(false);
  });

  it('未知状态不猜，按不需要重新登录处理', () => {
    expect(needsReauth('SOMETHING_NEW_FROM_SERVER')).toBe(false);
  });
});

describe('isActiveBinding', () => {
  /**
   * 判断依据是「远端会不会以已存在活跃绑定拒绝」，不是「这个账号好不好使」——
   * 所以失效的账号仍然占着绑定位。
   */
  it('登录失效仍然占着该渠道的绑定位', () => {
    expect(isActiveBinding('LOGIN_EXPIRED')).toBe(true);
    expect(isActiveBinding('INIT_FAILED')).toBe(true);
  });

  it('正常绑定占位', () => {
    expect(isActiveBinding('BOUND')).toBe(true);
  });

  it('只有解绑才释放绑定位', () => {
    expect(isActiveBinding('UNBOUND')).toBe(false);
  });

  it('未知状态按占位处理——宁可少给一个选项，也不让用户选了被远端拒绝', () => {
    expect(isActiveBinding('SOMETHING_NEW_FROM_SERVER')).toBe(true);
  });
});

describe('needsAttention', () => {
  it('与改动前的判定保持一致', () => {
    for (const status of ['LOGIN_FAILED', 'LOGIN_EXPIRED', 'INIT_FAILED', 'HOTEL_NAME_MISMATCH']) {
      expect(needsAttention(status)).toBe(true);
    }
  });

  it('「还没登完」不计入需要关注的异常', () => {
    expect(needsAttention('PENDING_LOGIN')).toBe(false);
    expect(needsAttention('WAITING_CAPTCHA')).toBe(false);
  });

  it('正常状态不计入', () => {
    expect(needsAttention('BOUND')).toBe(false);
    expect(needsAttention('UNBOUND')).toBe(false);
  });
});
