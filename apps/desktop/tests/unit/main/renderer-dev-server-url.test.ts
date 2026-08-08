import { describe, expect, it } from 'vitest';
import { resolveRendererDevServerUrl } from '../../../src/main/windows/renderer-dev-server-url';

describe('resolveRendererDevServerUrl', () => {
  it('upgrades the Electron Forge development URL to HTTPS', () => {
    expect(resolveRendererDevServerUrl('http://localhost:5174/')).toBe('https://localhost:5174/');
  });

  it('rejects non-web development URLs', () => {
    expect(() => resolveRendererDevServerUrl('file:///tmp/index.html')).toThrow(
      'Unsupported renderer development server protocol: file:',
    );
  });
});
