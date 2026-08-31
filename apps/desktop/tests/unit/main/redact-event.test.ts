import { describe, expect, it } from 'vitest';
import { redactEvent } from '../../../src/main/error-reporting/redact-event';

/**
 * 接入方案把「确认脱敏生效」列为最容易漏、也最重要的一条验收项。上报体会夹带渠道
 * cookie 与酒店经营数据，任何一处漏网都等于外泄一份凭证。
 */
describe('上报体脱敏', () => {
  it('抹掉 cookie 请求头', () => {
    const event = {
      request: {
        headers: { cookie: 'SESSION=abc123; token=deadbeef' },
        url: 'https://rms.example/hotel/list',
      },
    };

    const redacted = redactEvent(event);

    expect(JSON.stringify(redacted)).not.toContain('abc123');
    expect(redacted.request.url).toBe('https://rms.example/hotel/list');
  });

  /**
   * 只过 `event.request` 是不够的 —— 真正常见的泄漏点是有人把响应体塞进了
   * error message 或 extra。
   */
  it('抹掉嵌在异常 message 与 extra 深处的凭证', () => {
    const event = {
      exception: {
        values: [{ value: 'request failed: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9' }],
      },
      extra: {
        payload: { nested: { accessToken: 'tok_live_9f8e7d', phone: '13800138000' } },
      },
    };

    const serialized = JSON.stringify(redactEvent(event));

    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(serialized).not.toContain('tok_live_9f8e7d');
    expect(serialized).not.toContain('13800138000');
  });

  /** 脱敏不能把定位信息一起抹掉，否则上报就没意义了。 */
  it('保留用于定位的非敏感字段', () => {
    const event = {
      tags: { operation: 'reportAmountChange', channel: 'meituan', hotel_id: '1003' },
      extra: { rmsCode: 40001, reason: 'rejected' },
    };

    expect(redactEvent(event)).toEqual(event);
  });
});
