import { describe, expect, it } from 'vitest';
import {
  browserUserAgentFromVersion,
  defaultBrowserUserAgent,
  safeBrowserUserAgent,
} from '../../../src/main/browser/user-agent';

describe('browser User-Agent', () => {
  it('uses the verified Chrome default with the platform token', () => {
    expect(defaultBrowserUserAgent('darwin')).toContain('Chrome/155.0.0.0');
    expect(defaultBrowserUserAgent('win32')).toContain('Windows NT 10.0');
    expect(defaultBrowserUserAgent('linux')).toContain('X11; Linux x86_64');
    expect(defaultBrowserUserAgent('darwin')).not.toContain('Electron');
  });

  it('derives Chrome and Edge identifiers only from valid versions', () => {
    expect(browserUserAgentFromVersion('chrome', '155.0.8059.39', 'darwin')).toContain(
      'Chrome/155.0.0.0 Safari/537.36',
    );
    expect(browserUserAgentFromVersion('edge', '155.0.8059.39', 'win32')).toContain(
      'Edg/155.0.8059.39',
    );
    expect(browserUserAgentFromVersion('chrome', '155\r\nInjected: x', 'darwin')).toBeNull();
    expect(safeBrowserUserAgent('Mozilla/5.0 (x)\r\nInjected: x')).toBeNull();
  });
});
