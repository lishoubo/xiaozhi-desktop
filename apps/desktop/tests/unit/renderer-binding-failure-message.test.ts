import { describe, expect, it } from 'vitest';
import { bindingFailureMessage } from '../../src/renderer/components/browser/binding-failure-message';

describe('bindingFailureMessage', () => {
  it('剥掉 Electron 的 IPC 包装，只留远端业务文案', () => {
    const reason = new Error(
      "Error invoking remote method 'hotel-management:confirm-binding': Error: 该酒店的此渠道已存在活跃绑定",
    );
    expect(bindingFailureMessage(reason)).toBe('该酒店的此渠道已存在活跃绑定');
  });

  it('没有包装时原样返回', () => {
    expect(bindingFailureMessage(new Error('未找到该登录凭据'))).toBe('未找到该登录凭据');
  });

  it('拿不到可读原因时退回通用文案', () => {
    expect(bindingFailureMessage(new Error(''))).toBe('绑定失败，请重试。');
    expect(bindingFailureMessage('boom')).toBe('绑定失败，请重试。');
  });
});
