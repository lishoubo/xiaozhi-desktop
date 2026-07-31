import { describe, expect, it } from 'vitest';
import { parseCookieExport } from '../../../src/main/browser/cookie-import';

describe('parseCookieExport', () => {
  it('normalizes JSON cookie exports for Electron', () => {
    const cookies = parseCookieExport(
      JSON.stringify([
        {
          domain: '.ctrip.com',
          expirationDate: 1_900_000_000,
          httpOnly: true,
          name: 'session',
          path: '/',
          sameSite: 'lax',
          secure: true,
          value: 'token',
        },
      ]),
    );

    expect(cookies).toEqual([
      {
        domain: '.ctrip.com',
        expirationDate: 1_900_000_000,
        httpOnly: true,
        name: 'session',
        path: '/',
        sameSite: 'lax',
        secure: true,
        url: 'https://ctrip.com/',
        value: 'token',
      },
    ]);
  });

  it('parses Netscape cookie files and ignores comments', () => {
    const cookies = parseCookieExport(
      [
        '# Netscape HTTP Cookie File',
        '.meituan.com\tTRUE\t/\tTRUE\t1900000000\tmerchant\tabc',
      ].join('\n'),
    );

    expect(cookies).toEqual([
      {
        domain: '.meituan.com',
        expirationDate: 1_900_000_000,
        httpOnly: false,
        name: 'merchant',
        path: '/',
        secure: true,
        url: 'https://meituan.com/',
        value: 'abc',
      },
    ]);
  });

  it('rejects a file without importable cookies', () => {
    expect(() => parseCookieExport('[]')).toThrow('没有找到可导入的 Cookie');
  });
});
