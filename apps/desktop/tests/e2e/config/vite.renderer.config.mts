import { defineConfig, mergeConfig } from 'vite';

export default defineConfig(async () => {
  const { default: rendererConfig } = await import('../../../vite.renderer.config.mts');
  return mergeConfig(rendererConfig, {
    base: './',
    build: {
      outDir: '.e2e/renderer/main_window',
      emptyOutDir: true,
    },
  });
});
