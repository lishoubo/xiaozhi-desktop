import { builtinModules } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(''),
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
    // E2E 跑在本机，固定指向本地 rms-server。
    __RMS_ORIGIN__: JSON.stringify('http://localhost:8080'),
    // 这份 config 不走 vite.main.config.ts，拿不到 appEnvDefine()，得自己定义。
    __APP_ENV__: JSON.stringify('dev'),
    __APP_PRODUCT_NAME__: JSON.stringify('小智酒店管家[开发]'),
    __SERVER_ORIGIN__: JSON.stringify('https://localhost:4173'),
    // E2E 不上报：空串即关闭（见 main/error-reporting/init-error-reporting.ts）。
    __SENTRY_DSN__: JSON.stringify(''),
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
