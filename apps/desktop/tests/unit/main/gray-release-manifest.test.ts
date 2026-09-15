import { describe, expect, it } from 'vitest';
import {
  isPhoneAllowed,
  parseGrayReleaseManifest,
} from '../../../src/main/updater/gray-release-manifest';
import { digestPhone } from '../../../src/main/updater/phone-digest';

const SALT = 'test-salt';
const PHONE = '13800138000';

describe('digestPhone', () => {
  it('同样的手机号与盐得到同样的摘要', () => {
    expect(digestPhone(PHONE, SALT)).toBe(digestPhone(PHONE, SALT));
  });

  it('盐不同则摘要不同 —— 没有盐，名单里的哈希可被穷举反查', () => {
    expect(digestPhone(PHONE, SALT)).not.toBe(digestPhone(PHONE, 'other-salt'));
  });

  it('摘要里不含明文手机号', () => {
    expect(digestPhone(PHONE, SALT)).not.toContain(PHONE);
  });

  /** 名单是人工编辑的，前后空格是最常见的手误。 */
  it('忽略手机号首尾空白', () => {
    expect(digestPhone(`  ${PHONE}  `, SALT)).toBe(digestPhone(PHONE, SALT));
  });
});

describe('parseGrayReleaseManifest', () => {
  it('接受合法名单', () => {
    expect(parseGrayReleaseManifest({ allowAll: false, allowlist: ['abc'] })).toEqual({
      allowAll: false,
      allowlist: ['abc'],
    });
  });

  /**
   * 与 rms-auth-client 的契约校验相反：那里漂移要抛错，这里读不懂就当不命中。
   * 宁可漏升一次，不可让名单外的机器意外升级。
   */
  it.each([
    ['缺字段', { allowAll: true }],
    ['类型不对', { allowAll: 'yes', allowlist: [] }],
    ['多余字段', { allowAll: true, allowlist: [], extra: 1 }],
    ['不是对象', 'nonsense'],
    ['空值', null],
  ])('结构非法时返回 null（%s）', (_label, input) => {
    expect(parseGrayReleaseManifest(input)).toBeNull();
  });
});

describe('isPhoneAllowed', () => {
  it('allowAll 为 true 时任何手机号都命中', () => {
    const manifest = { allowAll: true, allowlist: [] };
    expect(isPhoneAllowed(manifest, PHONE, SALT)).toBe(true);
    expect(isPhoneAllowed(manifest, '13900139000', SALT)).toBe(true);
  });

  it('allowAll 为 false 时只有名单内的手机号命中', () => {
    const manifest = { allowAll: false, allowlist: [digestPhone(PHONE, SALT)] };
    expect(isPhoneAllowed(manifest, PHONE, SALT)).toBe(true);
    expect(isPhoneAllowed(manifest, '13900139000', SALT)).toBe(false);
  });

  it('名单为 null 时一律不命中 —— 拉取失败不该放行', () => {
    expect(isPhoneAllowed(null, PHONE, SALT)).toBe(false);
  });

  it('空名单不命中任何人', () => {
    expect(isPhoneAllowed({ allowAll: false, allowlist: [] }, PHONE, SALT)).toBe(false);
  });

  /** 盐配错时名单会整体失效，这条用例把"静默不升级"的原因固定下来。 */
  it('盐不一致时不命中', () => {
    const manifest = { allowAll: false, allowlist: [digestPhone(PHONE, SALT)] };
    expect(isPhoneAllowed(manifest, PHONE, 'wrong-salt')).toBe(false);
  });
});
