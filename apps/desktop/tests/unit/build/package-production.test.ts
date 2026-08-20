import { describe, expect, it } from 'vitest';
import {
  parseProductionDesktopCommand,
  PRODUCTION_RMS_ORIGIN,
  resolveProductionRmsOrigin,
} from '../../../scripts/package-production';

describe('production desktop packaging', () => {
  it('normalizes the production RMS origin, dropping any path', () => {
    expect(resolveProductionRmsOrigin('https://rms.example.com/api')).toBe(
      'https://rms.example.com',
    );
  });

  it('accepts plain HTTP: RMS has no HTTPS domain yet', () => {
    // 允许而非拒绝——可见性由调用方每次打印的 WARNING 保证，不靠这里抛错。
    expect(resolveProductionRmsOrigin('http://47.96.144.176')).toBe('http://47.96.144.176');
  });

  it('rejects non-HTTP protocols and credential-bearing URLs', () => {
    // 防的是将来把顶部常量改错，而不是运行期输入。
    expect(() => resolveProductionRmsOrigin('ftp://rms.example.com')).toThrow('HTTP(S)');
    expect(() => resolveProductionRmsOrigin('https://user:password@rms.example.com')).toThrow(
      'credentials',
    );
  });

  it('keeps the production RMS constant a valid, credential-free origin', () => {
    // 常量本身也要过这道校验，改错了测试就红。
    expect(resolveProductionRmsOrigin(PRODUCTION_RMS_ORIGIN)).toBe(PRODUCTION_RMS_ORIGIN);
  });

  it('accepts only check, package, and make while forwarding Forge arguments', () => {
    expect(parseProductionDesktopCommand(['check'])).toEqual({
      action: 'check',
      authVariant: 'staff',
      forwardedArguments: [],
    });
    expect(
      parseProductionDesktopCommand([
        'make',
        '--auth-variant=phone',
        '--platform=darwin',
        '--arch=arm64',
      ]),
    ).toEqual({
      action: 'make',
      authVariant: 'phone',
      forwardedArguments: ['--platform=darwin', '--arch=arm64'],
    });
    expect(() => parseProductionDesktopCommand(['publish'])).toThrow('production desktop action');
    expect(() => parseProductionDesktopCommand(['make', '--auth-variant=tablet'])).toThrow(
      'auth variant',
    );
    expect(() =>
      parseProductionDesktopCommand([
        'make',
        '--auth-variant=staff',
        '--auth-variant=phone',
      ]),
    ).toThrow('at most once');
    expect(() => parseProductionDesktopCommand(['check', '--arch=arm64'])).toThrow(
      'does not accept',
    );
  });
});
