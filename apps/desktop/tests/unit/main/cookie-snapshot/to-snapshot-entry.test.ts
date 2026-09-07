import { describe, expect, it } from 'vitest';
import {
  toSnapshotEntry,
  type CollectedCookie,
} from '../../../../src/main/browser/cookie-snapshot/to-snapshot-entry';

describe('cookie 快照字段映射', () => {
  describe('缺省即省略 key', () => {
    /**
     * 这条是本模块存在的理由：传 `null` 或补默认值都会让远端分不清「未设置」和
     * 「显式设置」，而两者在浏览器里是不同行为。断言用 `not.toHaveProperty`
     * 而不是 `toBeUndefined` —— 后者对 `{k: undefined}` 也会通过，测不出真问题。
     */
    it('来源未给 sameSite 时不产出该 key', () => {
      const entry = toSnapshotEntry({ name: 'a', value: '1', domain: '.x.com' }, 'cdp');

      expect(entry).not.toHaveProperty('sameSite');
    });

    it('来源未给 secure / httpOnly / path 时都不产出对应 key', () => {
      const entry = toSnapshotEntry({ name: 'a', value: '1', domain: '.x.com' }, 'cdp');

      expect(entry).not.toHaveProperty('secure');
      expect(entry).not.toHaveProperty('httpOnly');
      expect(entry).not.toHaveProperty('path');
    });

    it('secure=false 是有效取值，必须保留而不是当作缺省省略', () => {
      // 实测抖音 odin_tt 的 secure 就是 false，省略掉等于改写了这条 cookie
      const entry = toSnapshotEntry(
        { name: 'odin_tt', value: '1', domain: '.douyin.com', secure: false, httpOnly: false },
        'cdp',
      );

      expect(entry.secure).toBe(false);
      expect(entry.httpOnly).toBe(false);
    });

    it('省略的 key 不会在 JSON 序列化后出现', () => {
      const json = JSON.parse(
        JSON.stringify(toSnapshotEntry({ name: 'a', value: '1', domain: '.x.com' }, 'cdp')),
      ) as Record<string, unknown>;

      expect(Object.keys(json).sort()).toEqual(['domain', 'name', 'value']);
    });
  });

  describe('sameSite 映射', () => {
    it.each([
      ['no_restriction', 'None'],
      ['lax', 'Lax'],
      ['strict', 'Strict'],
    ])('Electron 值域 %s → %s', (raw, expected) => {
      const entry = toSnapshotEntry(
        { name: 'a', value: '1', domain: '.x.com', sameSite: raw },
        'electron',
      );

      expect(entry.sameSite).toBe(expected);
    });

    /**
     * `unspecified` 绝不可补成 "Lax"：未设置时浏览器走默认策略，显式 Lax 是另一回事。
     * 补默认值会让本该跨站携带的登录态不再被携带 —— 正是要修的那个 bug 的成因之一。
     */
    it('Electron 的 unspecified 省略字段，不补默认值', () => {
      const entry = toSnapshotEntry(
        { name: 'a', value: '1', domain: '.x.com', sameSite: 'unspecified' },
        'electron',
      );

      expect(entry).not.toHaveProperty('sameSite');
    });

    it('CDP 值域原样保留', () => {
      const entry = toSnapshotEntry(
        { name: 'a', value: '1', domain: '.x.com', sameSite: 'None' },
        'cdp',
      );

      expect(entry.sameSite).toBe('None');
    });

    it('CDP 给出未知值时省略而不是透传脏值', () => {
      const entry = toSnapshotEntry(
        { name: 'a', value: '1', domain: '.x.com', sameSite: 'Whatever' },
        'cdp',
      );

      expect(entry).not.toHaveProperty('sameSite');
    });
  });

  describe('expires 规则', () => {
    it('正数过期时间原样保留，含小数', () => {
      const entry = toSnapshotEntry(
        { name: 'a', value: '1', domain: '.x.com', expires: 1793456000.123 },
        'cdp',
      );

      expect(entry.expires).toBe(1793456000.123);
    });

    /** CDP 用 -1 表示会话 cookie，原样上送会被远端当成 1970 年的过期时间。 */
    it('CDP 的 expires: -1 省略该字段', () => {
      const entry = toSnapshotEntry(
        { name: 'a', value: '1', domain: '.x.com', expires: -1 },
        'cdp',
      );

      expect(entry).not.toHaveProperty('expires');
    });

    it('session: true 时省略 expires，即使同时给了正数', () => {
      const entry = toSnapshotEntry(
        { name: 'a', value: '1', domain: '.x.com', session: true, expires: 123 },
        'cdp',
      );

      expect(entry).not.toHaveProperty('expires');
    });

    it('Electron 会话 cookie（根本没给过期时间）省略 expires', () => {
      const entry = toSnapshotEntry({ name: 'a', value: '1', domain: '.x.com' }, 'electron');

      expect(entry).not.toHaveProperty('expires');
    });
  });

  describe('partitionKey 原样透传', () => {
    /**
     * ⚠️ 此 partition 不是 Electron partition（账号级 cookie 罐子），是 CHIPS 分区键。
     * 任何解析、归一化、转字符串都会让浏览器不认这个键，分区 cookie 因此失效。
     */
    it('对象形态原样透传，不解析不重组', () => {
      const partitionKey = { topLevelSite: 'https://douyin.com', hasCrossSiteAncestor: false };

      const entry = toSnapshotEntry(
        { name: 'sessionid_ls', value: '1', domain: '.life.douyin.com', partitionKey },
        'cdp',
      );

      expect(entry.partitionKey).toEqual(partitionKey);
    });

    it('字符串形态（旧版 Chrome）同样原样透传，不转成对象', () => {
      const entry = toSnapshotEntry(
        {
          name: 'sessionid_ls',
          value: '1',
          domain: '.life.douyin.com',
          partitionKey: 'https://douyin.com',
        },
        'cdp',
      );

      expect(entry.partitionKey).toBe('https://douyin.com');
    });

    it('无分区键时省略该字段', () => {
      const entry = toSnapshotEntry({ name: 'a', value: '1', domain: '.x.com' }, 'cdp');

      expect(entry).not.toHaveProperty('partitionKey');
    });
  });

  it('完整一条：九个字段齐全时全部保留', () => {
    const cookie: CollectedCookie = {
      name: 'sessionid_ls',
      value: 'xxx',
      domain: '.life.douyin.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'None',
      expires: 1793456000.123,
      session: false,
      partitionKey: { topLevelSite: 'https://douyin.com', hasCrossSiteAncestor: false },
    };

    expect(toSnapshotEntry(cookie, 'cdp')).toEqual({
      name: 'sessionid_ls',
      value: 'xxx',
      domain: '.life.douyin.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'None',
      expires: 1793456000.123,
      partitionKey: { topLevelSite: 'https://douyin.com', hasCrossSiteAncestor: false },
    });
  });

  it('domain 缺失时退回空串，保持既有行为', () => {
    expect(toSnapshotEntry({ name: 'a', value: '1' }, 'cdp').domain).toBe('');
  });
});
