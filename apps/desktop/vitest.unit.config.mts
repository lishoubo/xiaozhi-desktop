// The legacy CommonJS ESLint resolver cannot inspect this ESM-only package.
// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __RMS_ORIGIN__: JSON.stringify('http://localhost:8080'),
    __APP_ENV__: JSON.stringify('dev'),
    __APP_PRODUCT_NAME__: JSON.stringify('小智酒店管家[开发]'),
    __SERVER_ORIGIN__: JSON.stringify('https://localhost:5173'),
    __SENTRY_DSN__: JSON.stringify(''),
  },
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
