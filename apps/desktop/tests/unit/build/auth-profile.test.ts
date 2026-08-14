import { describe, expect, it } from 'vitest';
import {
  desktopProfileEnvironment,
  parseDesktopProfileCommand,
} from '../../../scripts/run-auth-profile';

describe('desktop authentication build profiles', () => {
  it('parses a closed profile/action pair and forwards Forge arguments', () => {
    expect(parseDesktopProfileCommand(['phone', 'make', '--platform=darwin'])).toEqual({
      profile: 'phone',
      action: 'make',
      forwardedArguments: ['--platform=darwin'],
    });
    expect(desktopProfileEnvironment('staff', { PATH: '/bin' })).toEqual({
      PATH: '/bin',
      XIAOZHI_AUTH_VARIANT: 'staff',
    });
  });

  it('rejects unknown profiles and actions before spawning Forge', () => {
    expect(() => parseDesktopProfileCommand(['unknown', 'make'])).toThrow(
      'desktop auth profile',
    );
    expect(() => parseDesktopProfileCommand(['phone', 'publish'])).toThrow(
      'desktop profile action',
    );
  });
});
