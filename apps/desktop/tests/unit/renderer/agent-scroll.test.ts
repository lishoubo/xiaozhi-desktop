import { describe, expect, it } from 'vitest';
import {
  isAgentViewportNearBottom,
  shouldFollowAgentViewport,
} from '../../../src/renderer/agent-scroll';

describe('Agent conversation scroll following', () => {
  it('follows content only while the viewport remains near the bottom', () => {
    expect(
      isAgentViewportNearBottom({ scrollHeight: 1_000, scrollTop: 552, clientHeight: 400 }),
    ).toBe(true);
    expect(
      isAgentViewportNearBottom({ scrollHeight: 1_000, scrollTop: 400, clientHeight: 400 }),
    ).toBe(false);
  });

  it('keeps following content growth and stops after an upward scroll', () => {
    expect(
      shouldFollowAgentViewport(
        { scrollHeight: 1_200, scrollTop: 552, clientHeight: 400 },
        552,
        true,
      ),
    ).toBe(true);
    expect(
      shouldFollowAgentViewport(
        { scrollHeight: 1_200, scrollTop: 300, clientHeight: 400 },
        552,
        true,
      ),
    ).toBe(false);
  });
});
