import { describe, expect, it } from 'vitest';
import { isCookieHostInScope } from '../../../src/domain/policy/cookie-scope-policy';

const CTRIP = ['ctrip.com', 'trip.com'];

describe('isCookieHostInScope', () => {
  it('匹配域本身与其子域', () => {
    expect(isCookieHostInScope('ctrip.com', CTRIP)).toBe(true);
    expect(isCookieHostInScope('hotels.ctrip.com', CTRIP)).toBe(true);
  });

  it('容忍 cookie host 的前导点', () => {
    expect(isCookieHostInScope('.ctrip.com', CTRIP)).toBe(true);
  });

  it('忽略大小写与空白', () => {
    expect(isCookieHostInScope('  Hotels.Ctrip.COM ', CTRIP)).toBe(true);
  });

  it('拒绝仅后缀相同的冒充域 —— 裸 endsWith 会在这里误判', () => {
    expect(isCookieHostInScope('evilctrip.com', CTRIP)).toBe(false);
    expect(isCookieHostInScope('notctrip.com', CTRIP)).toBe(false);
  });

  it('拒绝作用域外的渠道 —— 这是 D2 的修复点', () => {
    // 导入携程时，抖音/小红书/淘宝的 cookie 不该被读走
    for (const host of ['douyin.com', 'xiaohongshu.com', 'taobao.com', 'meituan.com']) {
      expect(isCookieHostInScope(host, CTRIP)).toBe(false);
    }
  });

  it('空域集合不匹配任何 host', () => {
    expect(isCookieHostInScope('ctrip.com', [])).toBe(false);
  });

  it('忽略域集合里的空条目，不因此放行一切', () => {
    expect(isCookieHostInScope('ctrip.com', ['', '  '])).toBe(false);
  });

  it('空 host 不匹配', () => {
    expect(isCookieHostInScope('', CTRIP)).toBe(false);
  });
});
