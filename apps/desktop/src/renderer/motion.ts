import type { AutoAnimateOptions } from '@formkit/auto-animate';
// ESLint's current resolver does not understand Svelte's documented package subpath export.
// eslint-disable-next-line import/no-unresolved
import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

type EnterTransitionOptions = {
  delay?: number;
  duration?: number;
  y?: number;
};

export const PAGE_ENTER_OPTIONS = Object.freeze({
  duration: 160,
  y: 6,
}) satisfies EnterTransitionOptions;

export const SURFACE_TRANSITION_OPTIONS = Object.freeze({
  duration: 180,
  y: 8,
}) satisfies EnterTransitionOptions;

export const LAYOUT_ANIMATION_OPTIONS = Object.freeze({
  duration: 180,
  easing: 'ease-out',
}) satisfies Partial<AutoAnimateOptions>;

export const ALERT_ANIMATION_OPTIONS = LAYOUT_ANIMATION_OPTIONS;

export function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function enter(node: Element, options: EnterTransitionOptions = {}): TransitionConfig {
  const { delay = 0, duration = PAGE_ENTER_OPTIONS.duration, y = PAGE_ENTER_OPTIONS.y } = options;
  const naturalTransform = getComputedStyle(node).transform.replace('none', '');

  return {
    delay: prefersReducedMotion() ? 0 : delay,
    duration: prefersReducedMotion() ? 0 : duration,
    easing: cubicOut,
    css: (t, u) => `opacity: ${t}; transform: ${naturalTransform} translate3d(0, ${u * y}px, 0);`,
  };
}
