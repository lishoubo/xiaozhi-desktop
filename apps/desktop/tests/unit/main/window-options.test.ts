import { describe, expect, it } from 'vitest';
import { createMainWindowOptions } from '../../../src/main/windows/window-options';

describe('createMainWindowOptions', () => {
  it('creates a secure renderer configuration', () => {
    const options = createMainWindowOptions('/app/preload.js');

    expect(options).toMatchObject({
      width: 1200,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      webPreferences: {
        preload: '/app/preload.js',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
  });
});
