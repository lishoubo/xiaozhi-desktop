import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import AgentAvatar from '../../src/renderer/components/agent/AgentAvatar.svelte';

describe('AgentAvatar', () => {
  it('exposes purposeful ambient motion and an online breathing light', () => {
    const { container } = render(AgentAvatar, {
      size: 'xl',
      online: true,
      motion: 'float',
    });

    expect(container.querySelector('[data-agent-avatar]')).toHaveAttribute('data-motion', 'float');
    expect(container.querySelector('[data-agent-status]')).toHaveAttribute(
      'data-agent-status',
      'breathing',
    );
  });
});
