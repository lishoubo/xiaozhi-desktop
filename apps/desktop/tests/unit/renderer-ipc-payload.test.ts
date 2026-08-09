import { describe, expect, it } from 'vitest';
import { toPlainJson } from '../../src/renderer/ipc-payload';

describe('toPlainJson', () => {
  it('unwraps a proxy so contextBridge can structured-clone it', () => {
    // Svelte 的 $state 把对象包成 Proxy；直接送进 IPC 会同步抛
    // "An object could not be cloned"，绕过调用方的 .catch()。
    const proxied = new Proxy({ merchantGroupId: '1813179858562059' }, {});

    const plain = toPlainJson(proxied);

    expect(plain).toEqual({ merchantGroupId: '1813179858562059' });
    expect(() => structuredClone(plain)).not.toThrow();
  });

  it('unwraps nested proxies too', () => {
    const nested = new Proxy({ outer: new Proxy({ inner: 'v' }, {}) }, {});

    expect(() => structuredClone(toPlainJson(nested))).not.toThrow();
  });

  it('passes scalars and null through untouched', () => {
    expect(toPlainJson(null)).toBeNull();
    expect(toPlainJson('douyin')).toBe('douyin');
    expect(toPlainJson(42)).toBe(42);
  });
});
