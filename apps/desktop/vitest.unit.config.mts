// The legacy CommonJS ESLint resolver cannot inspect this ESM-only package.
// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage/unit',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/domain/**/*.ts',
        'src/main/**/*.ts',
        'src/preload/**/*.ts',
        'src/shared/**/*.ts',
      ],
      exclude: [
        'src/main/index.ts',
        'src/main/composition/**',
        'src/main/windows/main-window.ts',
        'src/preload/index.ts',
      ],
    },
  },
});
