import { describe, expect, it } from 'vitest';
import { isAgentViewportNearBottom } from '../../../src/renderer/agent-scroll';

describe('Agent conversation scroll following', () => {
  it('follows content only while the viewport remains near the bottom', () => {
    expect(
      isAgentViewportNearBottom({ scrollHeight: 1_000, scrollTop: 552, clientHeight: 400 }),
    ).toBe(true);
    expect(
      isAgentViewportNearBottom({ scrollHeight: 1_000, scrollTop: 400, clientHeight: 400 }),
    ).toBe(false);
  });
});
