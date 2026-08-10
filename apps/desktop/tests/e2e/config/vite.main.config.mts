import { builtinModules } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';
import { E2E_AUTH_VARIANT_DEFINE } from './auth-variant.mts';

export default defineConfig({
  define: {
    ...E2E_AUTH_VARIANT_DEFINE,
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(''),
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
  },
  build: {
    target: 'node24',
    outDir: '.e2e/build',
    emptyOutDir: true,
    lib: {
      entry: path.resolve('src/main.ts'),
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: [
        'better-sqlite3',
        'electron',
        'electron-squirrel-startup',
        ...builtinModules,
        /^node:/,
      ],
    },
  },
});
