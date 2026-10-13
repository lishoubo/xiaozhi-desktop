// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { dialogKindOf, installDialogObserver } from '../../../src/preload/dialog-observer';

describe('embedded dialog observer', () => {
  it('accepts a cross-world event by shape and rejects unexpected payloads', () => {
    const event = new Event('dialog-observed');
    Object.defineProperty(event, 'detail', { value: 'alert' });
    expect(dialogKindOf(event)).toBe('alert');
    expect(dialogKindOf(new Event('dialog-observed'))).toBeNull();
    const spoofed = new Event('dialog-observed');
    Object.defineProperty(spoofed, 'detail', { value: { message: 'private' } });
    expect(dialogKindOf(spoofed)).toBeNull();
  });

  it('reports dialog kinds without exposing arguments and preserves native results', () => {
    const nativeAlert = vi.fn();
    const nativeConfirm = vi.fn(() => false);
    const nativePrompt = vi.fn(() => 'typed value');
    window.alert = nativeAlert;
    window.confirm = nativeConfirm;
    window.prompt = nativePrompt;
    const observed: unknown[] = [];
    window.addEventListener('dialog-observed', (event) => {
      observed.push(dialogKindOf(event));
    });

    installDialogObserver('dialog-observed');
    window.alert('private alert');
    expect(window.confirm('private confirm')).toBe(false);
    expect(window.prompt('private prompt', 'private default')).toBe('typed value');

    expect(observed).toEqual(['alert', 'confirm', 'prompt']);
    expect(nativeAlert).toHaveBeenCalledWith('private alert');
    expect(nativeConfirm).toHaveBeenCalledWith('private confirm');
    expect(nativePrompt).toHaveBeenCalledWith('private prompt', 'private default');
  });

  it('still calls the native dialog when the page breaks the diagnostic event', () => {
    const nativeAlert = vi.fn();
    window.alert = nativeAlert;
    const dispatch = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => {
      throw new Error('page-modified dispatchEvent');
    });

    installDialogObserver('dialog-observed');
    window.alert('private message');

    expect(nativeAlert).toHaveBeenCalledWith('private message');
    dispatch.mockRestore();
  });
});
