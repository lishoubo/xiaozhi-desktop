import type { AutoAnimateOptions } from '@formkit/auto-animate';

export const ALERT_ANIMATION_OPTIONS = Object.freeze({
  duration: 180,
  easing: 'ease-out',
}) satisfies Partial<AutoAnimateOptions>;
