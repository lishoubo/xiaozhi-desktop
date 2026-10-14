import { describe, expect, it, vi } from 'vitest';
import { resolveInstallationDirectory } from '../../../src/main/services/installation-directory';
import { SystemService } from '../../../src/main/services/system-service';

describe('installation directory', () => {
  it('shows the Squirrel root across app versions and the executable folder for portable builds', () => {
    expect(
      resolveInstallationDirectory(
        'C:\\Users\\viwei\\AppData\\Local\\xiaozhi-hotel\\app-1.0.7\\小智酒店管家.exe',
        'win32',
      ),
    ).toBe('C:\\Users\\viwei\\AppData\\Local\\xiaozhi-hotel');
    expect(
      resolveInstallationDirectory('C:\\Users\\viwei\\Desktop\\绿色版\\小智酒店管家.exe', 'win32'),
    ).toBe('C:\\Users\\viwei\\Desktop\\绿色版');
    expect(
      resolveInstallationDirectory('/Applications/小智酒店管家.app/Contents/MacOS/小智酒店管家', 'darwin'),
    ).toBe('/Applications/小智酒店管家.app');
  });

  it('opens and copies only the installation directory supplied by the main process', async () => {
    const openPath = vi.fn(async () => '');
    const writeText = vi.fn();
    const service = new SystemService({
      app: {
        getLoginItemSettings: () => ({ openAtLogin: false }),
        getVersion: () => '1.0.7',
        setLoginItemSettings: vi.fn(),
      },
      shell: { openPath, openExternal: vi.fn(async () => undefined) },
      logsDirectory: 'C:\\logs',
      installationDirectory: 'C:\\xiaozhi-hotel',
      clipboard: { writeText },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(service.getPreferences().installationDirectory).toBe('C:\\xiaozhi-hotel');
    await service.openInstallationDirectory();
    service.copyInstallationDirectory();
    expect(openPath).toHaveBeenCalledWith('C:\\xiaozhi-hotel');
    expect(writeText).toHaveBeenCalledWith('C:\\xiaozhi-hotel');
  });

  it('reports a shell failure when opening the installation directory', async () => {
    const service = new SystemService({
      app: {
        getLoginItemSettings: () => ({ openAtLogin: false }),
        getVersion: () => '1.0.7',
        setLoginItemSettings: vi.fn(),
      },
      shell: {
        openPath: vi.fn(async () => 'Access denied'),
        openExternal: vi.fn(async () => undefined),
      },
      logsDirectory: 'C:\\logs',
      installationDirectory: 'C:\\xiaozhi-hotel',
      clipboard: { writeText: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(service.openInstallationDirectory()).rejects.toThrow('Access denied');
  });
});
