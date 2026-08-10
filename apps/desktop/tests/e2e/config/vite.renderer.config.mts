import { defineConfig, mergeConfig } from 'vite';

export default defineConfig(async () => {
  const previousVariant = process.env.XIAOZHI_AUTH_VARIANT;
  process.env.XIAOZHI_AUTH_VARIANT = 'phone';
  try {
    const { default: rendererConfig } = await import('../../../vite.renderer.config.mts');
    return mergeConfig(rendererConfig, {
      base: './',
      build: {
        outDir: '.e2e/renderer/main_window',
        emptyOutDir: true,
      },
    });
  } finally {
    if (previousVariant === undefined) delete process.env.XIAOZHI_AUTH_VARIANT;
    else process.env.XIAOZHI_AUTH_VARIANT = previousVariant;
  }
});
