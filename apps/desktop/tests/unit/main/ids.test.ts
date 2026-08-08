import { describe, expect, it } from 'vitest';
import {
  InvalidIdentifierError,
  parseChannelId,
  toChannelId,
  toOtaCredentialId,
  toOtaHotelId,
} from '../../../src/main/ids';

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

describe('toOtaCredentialId', () => {
  it('接受规范化 credential 标识', () => {
    expect(toOtaCredentialId('douyin-credential-1')).toBe('douyin-credential-1');
  });

  it('拒绝空 credential 标识', () => {
    expect(() => toOtaCredentialId('')).toThrow(InvalidIdentifierError);
  });
});

describe('toOtaHotelId', () => {
  /**
   * 这是**外部系统的 ID**，只被存储与比较，不进 partition 名与磁盘路径，所以不套用
   * ChannelId 那套为路径安全而设的小写字符集规则。曾经套用过，代价是携程这类大写
   * ID 会在「远端已绑定成功之后」才抛错，把用户卡在绑定失败的死循环里。
   */
  it('接受大写与下划线等外部系统常见形态', () => {
    expect(toOtaHotelId('SHYQ-310042')).toBe('SHYQ-310042');
    expect(toOtaHotelId('742966120')).toBe('742966120');
    expect(toOtaHotelId('poi_88_A')).toBe('poi_88_A');
  });

  it('仍然拒绝空串 —— 会静默污染 (channel, ota_hotel_id) 唯一键', () => {
    expect(() => toOtaHotelId('')).toThrow(InvalidIdentifierError);
  });

  it('仍然拒绝超长值 —— 那是解析出错而非真实 ID', () => {
    expect(() => toOtaHotelId('a'.repeat(129))).toThrow(InvalidIdentifierError);
  });
});
