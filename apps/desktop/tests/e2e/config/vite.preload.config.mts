import { builtinModules } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';
import { E2E_AUTH_VARIANT_DEFINE } from './auth-variant.mts';

export default defineConfig({
  define: E2E_AUTH_VARIANT_DEFINE,
  build: {
    target: 'node24',
    outDir: '.e2e/build',
    emptyOutDir: false,
    lib: {
      entry: path.resolve('src/preload.ts'),
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rollupOptions: {
      external: ['electron', ...builtinModules, /^node:/],
    },
  },
});
