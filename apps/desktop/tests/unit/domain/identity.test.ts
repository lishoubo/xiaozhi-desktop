import { describe, expect, it } from 'vitest';
import {
  InvalidIdentifierError,
  parseChannelId,
  toChannelId,
  toOtaAccountId,
  toOtaCredentialId,
} from '../../../src/domain/identity';

describe('toChannelId', () => {
  it('接受合法的渠道标识', () => {
    expect(toChannelId('ctrip')).toBe('ctrip');
    expect(toChannelId('meituan')).toBe('meituan');
    expect(toChannelId('360-browser')).toBe('360-browser');
  });

  it('拒绝空串 —— 否则会在用户磁盘上留下永久的坏 partition', () => {
    expect(() => toChannelId('')).toThrow(InvalidIdentifierError);
  });

  it('拒绝大写 —— partition 要进磁盘路径，大小写混用在 Linux 会失败', () => {
    expect(() => toChannelId('CTRIP')).toThrow(InvalidIdentifierError);
    expect(() => toChannelId('Ctrip')).toThrow(InvalidIdentifierError);
  });

  it('拒绝会破坏 partition 字符串或路径的字符', () => {
    for (const raw of ['ctrip.com', 'ctrip/1', 'ctrip:1', 'ctrip 1', '../etc', 'ctrip\\1']) {
      expect(() => toChannelId(raw)).toThrow(InvalidIdentifierError);
    }
  });

  it('拒绝以连字符开头', () => {
    expect(() => toChannelId('-ctrip')).toThrow(InvalidIdentifierError);
  });

  it('拒绝超长标识', () => {
    expect(() => toChannelId('a'.repeat(65))).toThrow(InvalidIdentifierError);
  });
});

describe('parseChannelId', () => {
  it('不可信输入合法时返回标识', () => {
    expect(parseChannelId('ctrip')).toBe('ctrip');
  });

  it('不可信输入非法时返回 null 而非抛错', () => {
    expect(parseChannelId('CTRIP')).toBeNull();
    expect(parseChannelId('')).toBeNull();
    expect(parseChannelId(42)).toBeNull();
    expect(parseChannelId(null)).toBeNull();
    expect(parseChannelId(undefined)).toBeNull();
  });
});

describe('toOtaAccountId', () => {
  it('接受账号标识', () => {
    expect(toOtaAccountId('ctrip-account-1')).toBe('ctrip-account-1');
  });

  it('与 ChannelId 用同一套校验', () => {
    expect(() => toOtaAccountId('')).toThrow(InvalidIdentifierError);
  });
});

describe('toOtaCredentialId', () => {
  it('接受规范化 credential 标识', () => {
    expect(toOtaCredentialId('douyin-credential-1')).toBe('douyin-credential-1');
  });

  it('拒绝空 credential 标识', () => {
    expect(() => toOtaCredentialId('')).toThrow(InvalidIdentifierError);
  });
});
