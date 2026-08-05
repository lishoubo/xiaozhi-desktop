import path from 'node:path';
// The legacy CommonJS ESLint resolver cannot inspect these ESM-only packages.
// eslint-disable-next-line import/no-unresolved
import { svelteTesting } from '@testing-library/svelte/vite';
// eslint-disable-next-line import/no-unresolved
import { svelte } from '@sveltejs/vite-plugin-svelte';
// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    alias: {
      $lib: path.resolve('./src/renderer'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/component/**/*.test.ts'],
    setupFiles: ['./tests/setup/component.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage/component',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/renderer/**/*.{ts,svelte}'],
      exclude: ['src/renderer/main.ts', 'src/renderer/app.d.ts'],
    },
  },
});
