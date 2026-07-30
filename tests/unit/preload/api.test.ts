import { describe, expect, it } from 'vitest';
import { createDesktopApi } from '../../../src/preload/api';

describe('createDesktopApi', () => {
  it('exposes only the supported runtime versions', () => {
    const api = createDesktopApi({
      chrome: '140.0.0',
      electron: '43.0.0',
      node: '24.0.0',
    });

    expect(api).toEqual({
      versions: {
        chrome: '140.0.0',
        electron: '43.0.0',
        node: '24.0.0',
      },
    });
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.versions)).toBe(true);
  });
});
