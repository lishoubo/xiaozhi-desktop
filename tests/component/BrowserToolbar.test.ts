import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import BrowserToolbar from '../../src/renderer/components/browser/BrowserToolbar.svelte';

describe('BrowserToolbar', () => {
  it('renders the initial browser controls', () => {
    render(BrowserToolbar);

    expect(screen.getByText('Hotel Butler')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '网址' })).toHaveValue('https://example.com');
    expect(screen.getByRole('button', { name: '后退' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '前进' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '刷新' })).toBeDisabled();
  });
});
