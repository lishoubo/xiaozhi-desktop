import { afterEach, describe, expect, it, vi } from 'vitest';
import { enter, LAYOUT_ANIMATION_OPTIONS } from '../../src/renderer/motion';

afterEach(() => {
  vi.mocked(window.matchMedia).mockReset();
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }));
});

describe('renderer motion system', () => {
  it('uses the shared short layout-animation timing', () => {
    expect(LAYOUT_ANIMATION_OPTIONS).toEqual({ duration: 180, easing: 'ease-out' });
  });

  it('makes Svelte transitions immediate when reduced motion is preferred', () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }));

    const config = enter(document.createElement('main'), { delay: 40, duration: 180, y: 8 });

    expect(config.delay).toBe(0);
    expect(config.duration).toBe(0);
  });
});
