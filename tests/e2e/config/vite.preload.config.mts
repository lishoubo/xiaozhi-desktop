import { builtinModules } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'node22',
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
