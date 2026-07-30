import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../../src/main/settings/settings-service';

function createStore() {
  return {
    list: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    set: vi.fn().mockImplementation((key, value) => ({
      key,
      value,
      createdAt: 1,
      updatedAt: 1,
    })),
    delete: vi.fn().mockReturnValue(false),
  };
}

describe('SettingsService', () => {
  it('normalizes keys before calling the repository', () => {
    const store = createStore();
    const service = new SettingsService(store);

    service.set({ key: ' browser.homepage ', value: 'https://example.com' });

    expect(store.set).toHaveBeenCalledWith('browser.homepage', 'https://example.com');
  });

  it('rejects invalid keys and non-JSON values at the IPC boundary', () => {
    const service = new SettingsService(createStore());

    expect(() => service.get('')).toThrow(RangeError);
    expect(() => service.set({ key: 'valid', value: undefined })).toThrow(TypeError);
    expect(() => service.set({ key: 'valid', value: 1n })).toThrow(TypeError);
  });
});
