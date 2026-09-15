import { describe, expect, it } from 'vitest';
import { isNewerVersion } from '../../../src/main/updater/compare-versions';

describe('isNewerVersion', () => {
  it.each([
    ['1.0.1', '1.0.0'],
    ['1.1.0', '1.0.9'],
    ['2.0.0', '1.9.9'],
    ['1.0.10', '1.0.9'],
  ])('%s 比 %s 新', (latest, current) => {
    expect(isNewerVersion(latest, current)).toBe(true);
  });

  it.each([
    ['1.0.0', '1.0.0'],
    ['1.0.0', '1.0.1'],
    ['1.0.9', '1.0.10'],
    ['1.9.9', '2.0.0'],
  ])('%s 不比 %s 新', (latest, current) => {
    expect(isNewerVersion(latest, current)).toBe(false);
  });

  /**
   * 名单是人工编辑的。把 latestVersion 写成 "最新版" 这类值时，宁可不提示，
   * 也不要弹一个假通知。
   */
  it.each([
    ['非数字', '最新版'],
    ['段数不对', '1.0'],
    ['段数过多', '1.0.0.1'],
    ['空串', ''],
    ['负数', '1.0.-1'],
  ])('无法解析时保守返回 false（%s）', (_label, latest) => {
    expect(isNewerVersion(latest, '1.0.0')).toBe(false);
  });

  it('当前版本无法解析时也返回 false', () => {
    expect(isNewerVersion('1.0.1', 'unknown')).toBe(false);
  });

  /** 本项目不发预发布版；真发了这里偏保守，不会误判成有新版本。 */
  it('忽略预发布后缀', () => {
    expect(isNewerVersion('1.0.1-beta', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0-beta', '1.0.0')).toBe(false);
  });
});
