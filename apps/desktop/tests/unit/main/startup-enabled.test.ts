import { describe, expect, it } from 'vitest';
import {
  isStartupAutomationEnabled,
  type StartupAutomationEnv,
} from '../../../src/main/startup-enabled';

describe('isStartupAutomationEnabled', () => {
  it('默认关闭 —— 开机自动化必须显式 opt-in', () => {
    expect(isStartupAutomationEnabled({})).toBe(false);
  });

  it('显式设为 1 时开启', () => {
    expect(isStartupAutomationEnabled({ HOTEL_BUTLER_ENABLE_STARTUP_AUTOMATION: '1' })).toBe(true);
  });

  it('只认字面量 1，其他真值字符串一律视为关闭', () => {
    for (const value of ['true', 'yes', '0', '', 'TRUE', ' 1']) {
      expect(isStartupAutomationEnabled({ HOTEL_BUTLER_ENABLE_STARTUP_AUTOMATION: value })).toBe(
        false,
      );
    }
  });

  it('忽略已废弃的 DISABLE 开关 —— 老配置不得再让自动化开机运行', () => {
    // 真实的 process.env 会带着历史遗留变量进来，模拟升级上来的用户环境。
    // 类型层面已经写不出这个字段，这里验证运行时同样不受它影响。
    const legacyEnv = { HOTEL_BUTLER_DISABLE_STARTUP_AUTOMATION: '0' } as StartupAutomationEnv;
    expect(isStartupAutomationEnabled(legacyEnv)).toBe(false);
  });
});
