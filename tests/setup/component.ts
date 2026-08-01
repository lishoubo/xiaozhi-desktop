import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.mock('electron-log/renderer', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: TestResizeObserver,
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })),
});

Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  value: vi.fn(() => ({
    addEventListener: vi.fn((event: string, listener: EventListener) => {
      if (event === 'finish') {
        queueMicrotask(() => listener(new Event('finish')));
      }
    }),
    cancel: vi.fn(),
    finished: Promise.resolve(),
    pause: vi.fn(),
    play: vi.fn(),
  })),
});
