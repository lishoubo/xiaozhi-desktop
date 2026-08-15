import { describe, expect, it } from 'vitest';
import {
  parseProductionDesktopCommand,
  resolveProductionRmsOrigin,
} from '../../../scripts/package-production';

describe('production desktop packaging', () => {
  it('reads and normalizes the production RMS origin from the server environment', () => {
    expect(
      resolveProductionRmsOrigin('XIAOZHI_RMS_SERVER_URL="https://rms.example.com/api"\n'),
    ).toBe('https://rms.example.com');
  });

  it('rejects missing, placeholder, insecure, and credential-bearing RMS endpoints', () => {
    expect(() => resolveProductionRmsOrigin('POSTGRES_DB="hotel_butler"\n')).toThrow(
      'XIAOZHI_RMS_SERVER_URL',
    );
    expect(() =>
      resolveProductionRmsOrigin(
        'XIAOZHI_RMS_SERVER_URL="https://replace-with-rms-api-domain"\n',
      ),
    ).toThrow('placeholder');
    expect(() =>
      resolveProductionRmsOrigin('XIAOZHI_RMS_SERVER_URL="http://rms.example.com"\n'),
    ).toThrow('HTTPS');
    expect(() =>
      resolveProductionRmsOrigin(
        'XIAOZHI_RMS_SERVER_URL="https://user:password@rms.example.com"\n',
      ),
    ).toThrow('credentials');
  });

  it('allows HTTP only with the explicit insecure production override', () => {
    expect(
      resolveProductionRmsOrigin(
        'XIAOZHI_RMS_SERVER_URL="http://rms.example.com/api"\n',
        true,
      ),
    ).toBe('http://rms.example.com');
  });

  it('accepts only check, package, and make while forwarding Forge arguments', () => {
    expect(parseProductionDesktopCommand(['check'])).toEqual({
      action: 'check',
      forwardedArguments: [],
    });
    expect(
      parseProductionDesktopCommand(['make', '--platform=darwin', '--arch=arm64']),
    ).toEqual({
      action: 'make',
      forwardedArguments: ['--platform=darwin', '--arch=arm64'],
    });
    expect(() => parseProductionDesktopCommand(['publish'])).toThrow('production desktop action');
    expect(() => parseProductionDesktopCommand(['check', '--arch=arm64'])).toThrow(
      'does not accept',
    );
  });
});
