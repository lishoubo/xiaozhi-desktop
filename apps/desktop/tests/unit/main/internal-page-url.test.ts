import { describe, expect, it } from 'vitest';
import { buildUnifiedPricingUrl } from '../../../src/main/ipc/internal-page-handlers';

/**
 * 统一改价页的地址拼装。
 *
 * 两条负向断言（不带 refreshToken、不带 hotelId）比正向的更重要：
 *
 * - `refreshToken` 是 7 天期的长效凭证。传了它，页面就会把它落进 webview 的
 *   localStorage 自行续期 —— 与「登录态归主进程」的职责划分矛盾。
 * - `hotelId` 传错就是**改错酒店的价**。desktop 不维护「当前酒店」，手上没有可信的
 *   值可传，只能让页面从服务端 `me` 取。
 *
 * 两者都属于「加上去很自然、加错了后果很重」的字段，所以固化成用例。
 */
describe('buildUnifiedPricingUrl', () => {
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.payload.sig';

  it('落在 /unified-pricing 且带 token', () => {
    const url = new URL(buildUnifiedPricingUrl('https://rms.example.com', TOKEN));
    expect(url.origin).toBe('https://rms.example.com');
    expect(url.pathname).toBe('/unified-pricing');
    expect(url.searchParams.get('token')).toBe(TOKEN);
  });

  it('不带 refreshToken', () => {
    const url = new URL(buildUnifiedPricingUrl('https://rms.example.com', TOKEN));
    expect(url.searchParams.has('refreshToken')).toBe(false);
  });

  it('不带 hotelId', () => {
    const url = new URL(buildUnifiedPricingUrl('https://rms.example.com', TOKEN));
    expect(url.searchParams.has('hotelId')).toBe(false);
  });

  it('token 之外没有其他查询参数', () => {
    const url = new URL(buildUnifiedPricingUrl('https://rms.example.com', TOKEN));
    expect([...url.searchParams.keys()]).toEqual(['token']);
  });

  /** dev 下 web 前端带端口，拼接不能把它丢掉（丢了会落到 :80）。 */
  it('保留 origin 上的端口', () => {
    const url = new URL(buildUnifiedPricingUrl('http://localhost:5173', TOKEN));
    expect(url.origin).toBe('http://localhost:5173');
    expect(url.pathname).toBe('/unified-pricing');
  });

  /** JWT 里的 `.` `_` `-` 不该被转义成看不懂的形状，页面要原样读到。 */
  it('token 原样可读回', () => {
    const raw = 'a-b_c.d-e_f.g-h_i';
    const url = new URL(buildUnifiedPricingUrl('https://rms.example.com', raw));
    expect(url.searchParams.get('token')).toBe(raw);
  });

  /** 令牌进 URL 有长度上限（`browserWebUrlSchema` 限 2048），留足余量。 */
  it('典型令牌长度下 URL 远低于 2048 上限', () => {
    const longToken = `${'x'.repeat(800)}.${'y'.repeat(400)}.${'z'.repeat(100)}`;
    const url = buildUnifiedPricingUrl('https://rms.example.com', longToken);
    expect(url.length).toBeLessThan(2048);
  });
});
