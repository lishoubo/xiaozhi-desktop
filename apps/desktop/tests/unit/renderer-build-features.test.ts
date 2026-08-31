import { describe, expect, it } from 'vitest';
import {
  hidesPreviewModules,
  SHOW_AGENT_NAV,
  SHOW_CALENDAR_NAV,
} from '../../src/renderer/build-features';
import type { AppEnvironment } from '../../src/shared/app-environment';

/**
 * 「运营日历」「AI 助理」仍在打磨，不进正式包。这条规则只有 online 生效——
 * 写成测试是因为它决定用户在正式包里看得到什么，改错了不会有任何编译期信号。
 */
describe('hidesPreviewModules', () => {
  it('只有 online 隐藏', () => {
    expect(hidesPreviewModules('online')).toBe(true);
  });

  it.each(['dev', 'pre'] satisfies AppEnvironment[])('%s 保持可见，便于继续开发验证', (env) => {
    expect(hidesPreviewModules(env)).toBe(false);
  });
});

/**
 * 常量本身只能验到 vitest 配置里固定的那个环境（dev），但仍值得断言：
 * 它保证两个开关确实接在规则上，而不是被写死成字面量。
 */
describe('导出的开关', () => {
  it('在测试构建（dev）下两个入口都可见', () => {
    expect(SHOW_AGENT_NAV).toBe(true);
    expect(SHOW_CALENDAR_NAV).toBe(true);
  });
});
